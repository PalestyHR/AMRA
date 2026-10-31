const $ = id => document.getElementById(id);
let session, report, busy=false;
const names={e:'Symptom',r:'Recurrence',u:'Unresolved / deferred',c:'Critical impact',a:'Ambiguity',m:'Missing information'};
function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function status(t,error=false){$('status').textContent=t;$('status').className=error?'error':'';}
function needsHttps(){return !!session?.connection&&location.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(location.hostname);}
function setBusy(v){busy=v;for(const id of ['analyze','demo','validate','loadDemo'])$(id).disabled=v;$('analyze').disabled=v||needsHttps();}
async function post(path,data){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':session.token},body:JSON.stringify(data)});const x=await r.json();if(!r.ok){if(x.raw_output)$('raw').value=x.raw_output;throw Error(x.error||'Request failed');}return x;}
function list(title,items,parent){if(!Array.isArray(items)||!items.length)return;parent.append(el('b',title));const ul=el('ul');items.forEach(x=>ul.append(el('li',String(x))));parent.append(ul);}
function render(){
 $('results').replaceChildren();$('summary').replaceChildren();
 const counts={REVIEW:0,ROUTINE:0,'INSUFFICIENT INFORMATION':0,'CHECK OUTPUT':0};report.results.forEach(x=>{counts[x.label]=(counts[x.label]||0)+1;});
 const metrics=el('div',undefined,'metrics');for(const [key,title] of [['REVIEW','Review'],['ROUTINE','Routine'],['INSUFFICIENT INFORMATION','Unreadable'],['CHECK OUTPUT','Check output']]){const c=el('div',undefined,'metric');c.append(el('b',String(counts[key])),el('span',title));metrics.append(c);}$('summary').append(metrics);
 if(report.batch_issues.length)$('summary').append(el('p',report.batch_issues.join(' '),'issues'));
 for(const x of report.results){
 const card=el('article',undefined,'result');const top=el('div',undefined,'result-top');let cls=x.label==='REVIEW'?'review':x.label==='CHECK OUTPUT'?'check':x.label==='INSUFFICIENT INFORMATION'?'insufficient':'';
 top.append(el('b',x.id),el('span',x.label,'badge '+cls));card.append(top,el('p',x.reason,'reason'));
 const fs=el('div',undefined,'fields');for(const k of Object.keys(names)){if(k in x.fields)fs.append(el('span',`${k}=${x.fields[k]}`));}fs.append(el('span',`S=${x.score??'—'}`));card.append(fs);
 if(x.issues.length)card.append(el('div',x.issues.join(' '),'issues'));
 if(x.label==='CHECK OUTPUT'&&x.rule_label)card.append(el('p',`Rule result: ${x.rule_label}. Check the flagged output first.`,'hint'));
 const source=el('details');source.append(el('summary','Source & evidence'));source.append(el('p',x.source,'source'));for(const ev of x.evidence){source.append(el('b',`${names[ev.field]} · ${ev.record_id??'Unknown source'} · ${ev.matched?'Matched':'Check quote'}`),el('blockquote',String(ev.quote??'')));}card.append(source);
 const checks=el('details');checks.open=true;checks.append(el('summary','Review checklist'));list('Missing information',x.missing_information,checks);list('Follow-up checks',x.manual_checks,checks);
 const label=el('label','Review notes');const note=el('textarea');note.rows=2;note.placeholder='Add corrections, supporting evidence or next steps…';note.value=x.reviewer_note||'';note.addEventListener('input',()=>{x.reviewer_note=note.value;});label.append(note);checks.append(label);card.append(checks);$('results').append(card);
 }$('export').disabled=false;
}
async function run(mode){if(busy)return;setBusy(true);$('export').disabled=true;report=null;$('results').replaceChildren();$('summary').replaceChildren();status(mode==='live'?'Analyzing records…':'Checking evidence…');
 try{
 if(mode==='demo'){const demo=await (await fetch('/api/demo')).json();$('records').value=demo.text;$('raw').value=JSON.stringify(demo.extraction,null,2);}
 const config={base_url:$('base').value,model:$('model').value,api_key:$('key').value};
 report=await post(mode==='live'?'/api/analyze':'/api/validate',{text:$('records').value,...(mode==='live'?{config}:{raw:$('raw').value})});
 if(mode==='demo'){report.mode='curated_demo';report.model='Prepared sample data';}
 render();const usage=report.usage?.total_tokens;status(`${mode==='demo'?'Demo complete':mode==='live'?'Analysis complete':'Output checked'} · ${report.model} · ${report.duration_seconds}s${usage?' · '+usage+' tokens':''}`);
 }catch(e){status(e.message,true);}finally{setBusy(false);}}
$('provider').addEventListener('change',()=>{if($('provider').value==='deepseek'){$('base').value='https://api.deepseek.com';$('model').value='deepseek-flash';}else{$('base').value='';$('model').value='';}$('key').value='';});
$('analyze').onclick=()=>run('live');$('demo').onclick=()=>run('demo');$('validate').onclick=()=>run('import');
$('loadDemo').onclick=async()=>{try{const d=await(await fetch('/api/demo')).json();$('records').value=d.text;status('Sample records loaded.');}catch(e){status(e.message,true);}};
$('export').onclick=()=>{if(!report)return;const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=el('a');a.href=url;a.download=`review-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
setBusy(true);fetch('/api/session').then(r=>r.json()).then(x=>{session=x;if(x.connection){$('base').value=x.connection.base_url;$('model').value=x.connection.model;$('provider').value=x.connection.base_url==='https://api.deepseek.com'?'deepseek':'custom';$('provider').disabled=true;$('base').readOnly=true;if(needsHttps()){$('key').disabled=true;$('key').placeholder='Available over HTTPS';status('Demo ready. Live model analysis requires HTTPS.');}}setBusy(false);if(new URLSearchParams(location.search).get('demo')==='1')run('demo');}).catch(()=>status('Service unavailable. Reload the page and try again.',true));

$("openSettings").onclick=()=>$("settings").showModal();
$("closeSettings").onclick=()=>$("settings").close();
$("doneSettings").onclick=()=>$("settings").close();

function toggleHandbook(open) {
 const drawer=$('handbookToggle').closest('.handbook-drawer');
 drawer.classList.toggle('is-open',open);
 $('handbookToggle').setAttribute('aria-expanded',String(open));
 $('handbookNote').inert=!open;
}
$('handbookToggle').onclick=()=>toggleHandbook($('handbookToggle').getAttribute('aria-expanded')!=='true');
$('closeHandbook').onclick=()=>{toggleHandbook(false);$('handbookToggle').focus();};
$('handbookNote').addEventListener('keydown',event=>{if(event.key==='Escape'){toggleHandbook(false);$('handbookToggle').focus();}});
