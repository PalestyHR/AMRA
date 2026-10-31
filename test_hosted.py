import json
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

from waitress import create_server
import app
import hosted


class HostedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = create_server(hosted.application, host='127.0.0.1', port=0, threads=2)
        cls.base = f'http://127.0.0.1:{cls.server.effective_port}'
        cls.thread = threading.Thread(target=cls.server.run, daemon=True)
        cls.thread.start()
        cls.demo = json.loads((app.ROOT / 'demo.json').read_text(encoding='utf-8'))

    @classmethod
    def tearDownClass(cls):
        cls.server.close()
        cls.server.task_dispatcher.shutdown()
        cls.thread.join(timeout=2)

    def request(self, path, data=None, headers=None):
        headers = dict(headers or {})
        if data is not None:
            headers.setdefault('Content-Type', 'application/json')
            headers.setdefault('X-Session-Token', app.TOKEN)
        req = Request(self.base + path, data=None if data is None else json.dumps(data).encode(), headers=headers)
        try:
            response = urlopen(req, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read()

    def test_static_page_and_health(self):
        status, headers, body = self.request('/')
        self.assertEqual(status, 200)
        self.assertIn(b'id="globe"', body)
        self.assertIn("connect-src 'self'", headers['Content-Security-Policy'])
        self.assertEqual(json.loads(self.request('/healthz')[2])['status'], 'ok')

    def test_session_and_local_assets(self):
        session = json.loads(self.request('/api/session')[2])
        self.assertEqual(session['connection']['base_url'], hosted.API_BASE_URL)
        self.assertNotIn('api_key', session)
        for path in ['/app.js', '/style.css', '/api/demo', '/landing.js', '/landing.css', '/assets/coastlines.json']:
            self.assertEqual(self.request(path)[0], 200)
        self.assertIn(b'id="records"', self.request('/workbench')[2])

    def test_demo_import_preserves_the_three_routes(self):
        status, _, body = self.request('/api/validate', {
            'text': self.demo['text'], 'raw': json.dumps(self.demo['extraction'])})
        self.assertEqual(status, 200)
        labels = [r['label'] for r in json.loads(body)['results']]
        self.assertEqual(labels, ['ROUTINE', 'REVIEW', 'INSUFFICIENT INFORMATION'])

    def test_incorrect_quote_is_visible(self):
        extraction = json.loads(json.dumps(self.demo['extraction']))
        extraction['records'][0]['evidence']['e'][0]['quote'] = 'not in this source'
        status, _, body = self.request('/api/validate', {
            'text': self.demo['text'], 'raw': json.dumps(extraction)})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['results'][0]['label'], 'CHECK OUTPUT')

    def test_invalid_model_output_can_be_inspected(self):
        status, _, body = self.request('/api/validate', {'text': self.demo['text'], 'raw': '{broken'})
        self.assertEqual(status, 422)
        self.assertEqual(json.loads(body)['raw_output'], '{broken')

    def test_wrong_token_or_cross_site_origin_is_rejected(self):
        payload = {'text': self.demo['text'], 'raw': json.dumps(self.demo['extraction'])}
        self.assertEqual(self.request('/api/validate', payload, {'X-Session-Token': 'wrong'})[0], 403)
        self.assertEqual(self.request('/api/validate', payload, {'Origin': 'https://another-site.example'})[0], 403)

    def test_non_public_files_are_not_served(self):
        for path in ['/app.py', '/hosted.py', '/.env', '/deploy/amra.env.example']:
            self.assertEqual(self.request(path)[0], 404)

    def test_live_route_pins_provider_and_omits_key_from_output(self):
        raw = json.dumps(self.demo['extraction'])
        with patch('app.call_model', return_value=(raw, {'total_tokens': 12}, 'test-model')) as call:
            status, _, body = self.request('/api/analyze', {
                'text': self.demo['text'], 'config': {
                    'base_url': 'https://127.0.0.1/private', 'model': 'test-model', 'api_key': 'test-only-key'}})
        self.assertEqual(status, 200)
        self.assertEqual(call.call_args.args[0]['base_url'], hosted.API_BASE_URL)
        self.assertEqual(call.call_args.args[0]['api_key'], 'test-only-key')
        self.assertNotIn(b'test-only-key', body)
        self.assertEqual(json.loads(body)['mode'], 'live_api')


if __name__ == '__main__':
    unittest.main()
