import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
import app

class RulesTests(unittest.TestCase):
    def setUp(self):
        self.records=[{'id':'A','text':'A | symptom repaired; check normal.'}]
        self.item={'id':'A','readability':'readable','fields':dict.fromkeys(app.FIELDS,0),
                   'evidence':{},'reason':'正常记录','missing_information':[],'manual_checks':[]}
    def check(self):return app.evaluate(self.records,{'records':[self.item]})['results'][0]
    def one(self,k):
        self.item['fields'][k]=1
        self.item['evidence'][k]=[{'record_id':'A','quote':'symptom'}]
    def test_corrected_symptom_stays_routine(self):
        self.one('e');r=self.check();self.assertEqual((r['score'],r['label']),(2,'ROUTINE'))
    def test_threshold(self):
        self.one('e');self.one('c');self.assertEqual(self.check()['label'],'REVIEW')
    def test_missing_information_overrides_low_score(self):
        self.one('m');r=self.check();self.assertEqual((r['score'],r['label']),(0,'REVIEW'))
    def test_unreadable_overrides_scores(self):
        self.item['readability']='unreadable';self.one('m')
        r=self.check();self.assertEqual(r['label'],'INSUFFICIENT INFORMATION');self.assertIsNone(r['score']);self.assertTrue(r['issues'])
    def test_invented_quote_routes_to_check(self):
        self.one('e');self.item['evidence']['e'][0]['quote']='invented'
        self.assertEqual(self.check()['label'],'CHECK OUTPUT')
    def test_boolean_field_rejected(self):
        self.item['fields']['e']=True;self.assertEqual(self.check()['label'],'CHECK OUTPUT')
    def test_missing_record_not_dropped(self):
        r=app.evaluate(self.records,{'records':[]});self.assertEqual(len(r['results']),1);self.assertEqual(r['results'][0]['label'],'CHECK OUTPUT')
    def test_duplicate_record_blocked(self):
        r=app.evaluate(self.records,{'records':[self.item,self.item]});self.assertEqual(r['results'][0]['label'],'CHECK OUTPUT')
    def test_later_history_blocked(self):
        self.records.append({'id':'B','text':'B | later symptom'})
        self.one('r');self.item['evidence']['r']=[{'record_id':'B','quote':'later symptom'}]
        self.assertEqual(self.check()['label'],'CHECK OUTPUT')
    def test_other_record_symptom_blocked(self):
        self.records.insert(0,{'id':'B','text':'B | symptom'})
        self.one('e');self.item['evidence']['e']=[{'record_id':'B','quote':'symptom'}]
        self.assertEqual(self.check()['label'],'CHECK OUTPUT')
    def test_input_validation(self):
        with self.assertRaises(ValueError):app.parse_records(' ')
        with self.assertRaises(ValueError):app.parse_records('A | first\n\nA | second')
    def test_fenced_json(self):
        self.assertEqual(app.decode_output('```json\n{"records": []}\n```'),{'records':[]})
    def test_api_request_mock(self):
        class Reply:
            def __enter__(s):return s
            def __exit__(s,*args):pass
            def read(s,n):return json.dumps({'model':'test-model','choices':[{'message':{'content':'{"records":[]}'},'finish_reason':'stop'}],'usage':{'total_tokens':12}}).encode()
        with patch('app.urllib.request.build_opener') as mocked:
            mocked.return_value.open.return_value=Reply()
            raw,usage,model=app.call_model({'base_url':'https://api.deepseek.com','model':'chosen','api_key':'test-only'},self.records)
            request=mocked.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url,'https://api.deepseek.com/chat/completions')
            self.assertEqual(json.loads(request.data)['model'],'chosen');self.assertEqual(model,'test-model')
            self.assertEqual(usage['total_tokens'],12)
    def test_api_error_does_not_expose_key(self):
        with patch('app.urllib.request.build_opener') as mocked:
            mocked.return_value.open.side_effect=HTTPError('https://example.com',401,'test-key',{},None)
            with self.assertRaisesRegex(ValueError,'401') as err:
                app.call_model({'base_url':'https://example.com','model':'x','api_key':'test-key'},self.records)
            self.assertNotIn('test-key',str(err.exception))

if __name__=='__main__':unittest.main()
