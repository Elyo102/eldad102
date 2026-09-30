const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
function section(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
function setup(callApi) {
  const data = new Map();
  const element = {classList:{add(){},remove(){}}, textContent:''};
  const c = { navigator:{onLine:true}, localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}, $:()=>element,
    window:{addEventListener(){}}, callApi, showToast(){}, refreshMonth(){}, console, Date, TypeError, Error, JSON };
  vm.createContext(c);
  vm.runInContext(section("const OFFLINE_QUEUE_KEY", "// Service Worker"), c);
  return {c,data,queue:()=>JSON.parse(data.get('ds102_offline_queue')||'[]')};
}
test('HTTP 403 does not discard a pending report', async()=>{
 const {c,queue}=setup(async()=>{throw Error('403');}); c.queueOfflineAction('saveManualShift',{code:'test',date:'2026-09-01'});
 await c.flushOfflineQueue(); assert.equal(queue().length,1);
});
test('report added during synchronization survives acknowledgement of older report', async()=>{
 let release; const {c,queue}=setup(()=>new Promise(r=>release=r)); c.queueOfflineAction('saveManualShift',{date:'first'});
 const job=c.flushOfflineQueue(); await new Promise(r=>setImmediate(r)); c.queueOfflineAction('saveManualShift',{date:'second'});
 release({success:true}); await job; assert.equal(queue().length,1); assert.equal(queue()[0].params.date,'second');
});
test('overlapping synchronization does not send the same report twice', async()=>{
 let releases=[], calls=0; const {c}=setup(()=>{calls++; return new Promise(r=>releases.push(r));}); c.queueOfflineAction('saveManualShift',{date:'first'});
 const a=c.flushOfflineQueue(), b=c.flushOfflineQueue(); await new Promise(r=>setImmediate(r)); releases.forEach(r=>r({success:true})); await Promise.all([a,b]); assert.equal(calls,1);
});
test('unconfirmed response cannot remove a pending report', async()=>{
 const {c,queue}=setup(async()=>({})); c.queueOfflineAction('saveManualShift',{date:'first'}); await c.flushOfflineQueue(); assert.equal(queue().length,1);
});
test('malformed saved queue is never replaced by an empty queue',()=>{
 const {c,data}=setup(); data.set('ds102_offline_queue','broken saved data'); assert.throws(()=>c.queueOfflineAction('saveManualShift',{})); assert.equal(data.get('ds102_offline_queue'),'broken saved data');
});
test('refresh keeps local reports, session and other applications caches',async()=>{
 const deleted=[], unregistered=[]; let cleared=false;
 const c={document:{getElementById:()=>null,baseURI:'https://elyo102.github.io/eldad102/'},confirm:()=>true, Date,URL,
  navigator:{serviceWorker:{getRegistrations:async()=>[{scope:'https://elyo102.github.io/eldad102/',unregister:async()=>unregistered.push('app')},{scope:'https://elyo102.github.io/other/',unregister:async()=>unregistered.push('other')}] }},
  caches:{keys:async()=>['ds102-shell-v73','other-cache'],delete:async k=>deleted.push(k)},
  localStorage:{getItem:()=> '[]',clear:()=>cleared=true},sessionStorage:{clear:()=>cleared=true},OFFLINE_QUEUE_KEY:'ds102_offline_queue',
  location:{origin:'https://elyo102.github.io',pathname:'/eldad102/',replace(){}},window:{caches:true}};
 vm.createContext(c);vm.runInContext(section('async function clearAppCacheAndReload()',"document.addEventListener('DOMContentLoaded', buildClearCacheButton)"),c);
 await c.clearAppCacheAndReload(); assert.equal(cleared,false);assert.deepEqual(deleted,['ds102-shell-v73']);assert.deepEqual(unregistered,['app']);
});

function apiContext(fetch) {
 const c={fetch,AbortController,setTimeout,clearTimeout,URL,Date,Error,CONFIG:{API_URL:'https://script.google.com/macros/s/test/exec'}};
 vm.createContext(c);vm.runInContext(section('async function apiRequest(', '// silent=true'),c);return c;
}
for (const status of [403,429]) test('HTTP '+status+' has a useful message and no retry',async()=>{
 let calls=0;const c=apiContext(async()=>{calls++;return {ok:false,status};});await assert.rejects(c.apiGet('ping'),new RegExp(String(status)));assert.equal(calls,1);
});
test('HTML access page is a controlled error',async()=>{
 const c=apiContext(async()=>({ok:true,json:async()=>{throw SyntaxError('Unexpected <');}}));await assert.rejects(c.apiGet('ping'),/תשובה לא תקינה/);
});
test('POST preserves simple request and does not retry network failure',async()=>{
 let calls=0; const c=apiContext(async(url,options)=>{calls++;assert.equal(options.headers['Content-Type'],'text/plain;charset=utf-8');assert.equal(options.credentials,'omit');assert.equal(JSON.parse(options.body).action,'saveManualShift');throw TypeError('failed fetch');});
 await assert.rejects(c.apiPost('saveManualShift',{code:'synthetic'}),e=>e.networkFailure===true);assert.equal(calls,1);
});
test('successful JSON API contract is unchanged',async()=>{
 const c=apiContext(async()=>({ok:true,json:async()=>({success:true,valid:true})}));assert.equal((await c.apiGet('ping')).success,true);
});
test('failed report blocks later edits so retry cannot overwrite a newer report',async()=>{
 let calls=0;const {c,queue}=setup(async()=>{calls++;throw Error('404');});c.queueOfflineAction('saveManualShift',{date:'same',hours:1});c.queueOfflineAction('saveManualShift',{date:'same',hours:2});await c.flushOfflineQueue();assert.equal(calls,1);assert.equal(queue().length,2);
});
test('legacy report fields survive failed synchronization exactly',async()=>{
 const {c,data}=setup(async()=>{throw Error('validation');});const raw=JSON.stringify([{action:'saveManualShift',params:{date:'test',hours:12,note:'keep'},queuedAt:'old'}]);data.set('ds102_offline_queue',raw);await c.flushOfflineQueue();assert.equal(data.get('ds102_offline_queue'),raw);
});
test('temporary redirect 404 retries a safe read once from original endpoint',async()=>{
 const urls=[];const c=apiContext(async url=>{urls.push(url);return urls.length===1?{ok:false,status:404}:{ok:true,json:async()=>({success:true})};});assert.equal((await c.apiGet('ping')).success,true);assert.equal(urls.length,2);assert.notEqual(urls[0],urls[1]);assert.ok(urls.every(u=>u.startsWith(c.CONFIG.API_URL)));
});
test('persistent 404 stops after two read attempts',async()=>{
 let calls=0;const c=apiContext(async()=>{calls++;return {ok:false,status:404};});await assert.rejects(c.apiGet('login'),/404/);assert.equal(calls,2);
});
test('POST and mutating GET are never replayed on 404',async()=>{
 let calls=0;const c=apiContext(async()=>{calls++;return {ok:false,status:404};});await assert.rejects(c.apiPost('saveManualShift'),/404/);assert.equal(calls,1);await assert.rejects(c.apiGet('importGuardEvents'),/404/);assert.equal(calls,2);
});
const swSource=fs.readFileSync(require('node:path').join(__dirname,'../service-worker.js'),'utf8');
function swContext(fetch,match) {
 const handlers={},removed=[];
 const c={URL,Response,AbortController,setTimeout,clearTimeout,importScripts(){},firebase:{initializeApp(){},messaging:()=>({onBackgroundMessage(){}})},
 self:{location:{origin:'https://elyo102.github.io'},addEventListener:(n,f)=>handlers[n]=f,clients:{claim:async()=>{}}},
 caches:{keys:async()=>['ds102-shell-v73',swSource.match(/ds102-shell-v\d+/)[0],'other-cache'],delete:async k=>removed.push(k),open:async()=>({match,put:async()=>{}})},fetch};
 vm.createContext(c);vm.runInContext(swSource,c);return {handlers,removed};
}
test('offline navigation with fresh query gets cached application shell',async()=>{
 const {handlers}=swContext(async()=>{throw Error('offline');},async key=>key==='./index.html'?new Response('shell'):undefined);
 let response;handlers.fetch({request:{url:'https://elyo102.github.io/eldad102/?fresh=123',method:'GET',mode:'navigate'},respondWith:p=>response=p});assert.equal(await (await response).text(),'shell');
});
test('worker leaves Google API traffic untouched',()=>{
 const {handlers}=swContext(()=>assert.fail('fetch called'));handlers.fetch({request:{url:'https://script.googleusercontent.com/macros/echo',method:'GET'},respondWith:()=>assert.fail('intercepted API')});
});
test('cache activation does not delete another app cache',async()=>{
 const {handlers,removed}=swContext();let job;handlers.activate({waitUntil:p=>job=p});await job;assert.deepEqual(removed,['ds102-shell-v73']);
});
test('current app files are served from network instead of stale cache',async()=>{
 const {handlers}=swContext(async()=>new Response('current'),async()=>new Response('stale'));let response;handlers.fetch({request:{url:'https://elyo102.github.io/eldad102/app.js',method:'GET'},respondWith:p=>response=p});assert.equal(await (await response).text(),'current');
});
test('corrupt saved queue does not crash application startup or synchronization',async()=>{
 const {c,data}=setup();data.set('ds102_offline_queue','damaged');assert.doesNotThrow(()=>c.updateOfflineQueueBanner());await c.flushOfflineQueue();assert.equal(data.get('ds102_offline_queue'),'damaged');
});
test('array responses used by listShifts remain valid',async()=>{
 const c=apiContext(async()=>({ok:true,json:async()=>[{dateStr:'test',hours:12}]}));const result=await c.apiGet('listShifts');assert.equal(result[0].hours,12);
});
test('three overlapping identical reads use one request and later reads are fresh',async()=>{
 let calls=0,release;const c=apiContext(async()=>{calls++;await new Promise(r=>release=r);return {ok:true,json:async()=>[]};});
 const a=c.apiGet('listShifts',{code:'test',monthKey:'2026-09'}),b=c.apiGet('listShifts',{monthKey:'2026-09',code:'test'}),d=c.apiGet('listShifts',{code:'test',monthKey:'2026-09'});assert.equal(calls,1);release();await Promise.all([a,b,d]);const next=c.apiGet('listShifts',{code:'test',monthKey:'2026-09'});assert.equal(calls,2);release();await next;
});
test('reads for different months stay separate',async()=>{
 let calls=0;const c=apiContext(async()=>{calls++;return {ok:true,json:async()=>[]};});await Promise.all([c.apiGet('listShifts',{monthKey:'2026-09'}),c.apiGet('listShifts',{monthKey:'2026-10'})]);assert.equal(calls,2);
});
test('a write invalidates a pending read before the next refresh',async()=>{
 const releases=[];let calls=0;const c=apiContext(async(u,o)=>{if(o.method==='POST')return {ok:true,json:async()=>({success:true})};calls++;await new Promise(r=>releases.push(r));return {ok:true,json:async()=>[]};});const old=c.apiGet('listShifts');await c.apiPost('saveManualShift');const fresh=c.apiGet('listShifts');assert.equal(calls,2);releases.forEach(r=>r());await Promise.all([old,fresh]);
});
test('delayed older month cannot replace current month or its cache',async()=>{
 const pending=[],saved=[]; const state={code:'test',currentMonth:new Date(2026,8,1),shifts:[]};
 const c={state,MONTH_NAMES:Array(12).fill('month'),$ :()=>({}),monthKeyOf:d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'),renderMonthFromCache:()=>false,callApi:()=>new Promise(r=>pending.push(r)),saveMonthToCache:(k,v)=>saved.push(k),renderShifts(){},renderStatsBreakdown(){},showToast(){}};vm.createContext(c);vm.runInContext(section('let monthLoadSequence = 0;', 'function renderShifts()'),c);const old=c.refreshMonth();state.currentMonth=new Date(2026,9,1);const next=c.refreshMonth();pending[1]([{hours:2,dateStr:'2026-10-01'}]);await next;pending[0]([{hours:9,dateStr:'2026-09-01'}]);await old;assert.equal(state.shifts[0].hours,2);assert.deepEqual(saved,['2026-10']);
});

test('invalid month response preserves displayed and cached reports',async()=>{
 const saved=[],original=[{dateStr:'2026-09-01',hours:24}];const state={code:'test',currentMonth:new Date(2026,8,1),shifts:original};
 const c={state,MONTH_NAMES:Array(12).fill('month'),$:()=>({}),monthKeyOf:()=> '2026-09',renderMonthFromCache:()=>true,callApi:async()=>({unexpected:true}),saveMonthToCache:()=>saved.push(1),renderShifts(){},renderStatsBreakdown(){},showToast(){}};
 vm.createContext(c);vm.runInContext(section('let monthLoadSequence = 0;','function renderShifts()'),c);await c.refreshMonth();assert.equal(state.shifts,original);assert.equal(saved.length,0);
});
for(const method of ['POST','GET'])test('legacy fallback cannot write or read a different month: '+method,async()=>{
 const calls=[];const c={Date,Error,monthKeyOf:()=> '2026-09',callApi:async(m,a)=>{calls.push(a);throw Error('פעולה לא מוכרת');}};vm.createContext(c);vm.runInContext(section('async function callWithFallback_(',"$('check-issues-btn')"),c);
 await assert.rejects(c.callWithFallback_(method,'new','old',{code:'test',monthKey:method==='POST'?'2026-09':'2026-08'}),/לא בוצע שינוי/);assert.deepEqual(calls,['new']);
});
test('partial bootstrap leaves existing signature untouched',async()=>{
 const c={state:{code:'test',currentMonth:new Date()},monthLoadSequence:0,monthKeyOf:()=> '2026-09',apiGet:async()=>({valid:true,errors:['signature']}),myStoredSignature:'saved signature',myStoredSignatureAt:'saved time',renderSignatureButton:()=>assert.fail('signature changed'),showToast(){}};
 vm.createContext(c);vm.runInContext(section('async function loadBootstrap(', '// ====================================================================='),c);await c.loadBootstrap();assert.equal(c.myStoredSignature,'saved signature');assert.equal(c.myStoredSignatureAt,'saved time');
});
test('uncached month renders before slower ancillary response and ignores another account',async()=>{
 let release;const calls=[],rendered=[],state={code:'test',currentMonth:new Date()};const c={state,monthLoadSequence:0,monthKeyOf:()=> '2026-09',apiGet:async(a,p)=>{calls.push(p.section);if(p.section==='hours')return{valid:true,shifts:[{dateStr:'2026-09-01',hours:24}]};return new Promise(r=>release=r);},saveMonthToCache(){},renderShifts:()=>rendered.push('month'),renderStatsBreakdown(){},$:()=>({}),myStoredSignature:'keep',myStoredSignatureAt:null,renderSignatureButton(){},showToast(){}};vm.createContext(c);vm.runInContext(section('async function loadBootstrap(', '// ====================================================================='),c);const pending=c.loadBootstrap(true);await new Promise(r=>setImmediate(r));assert.deepEqual(calls,['hours','extras']);assert.deepEqual(rendered,['month']);assert.equal(state.shifts[0].hours,24);state.code='another';release({signature:'wrong account'});await pending;assert.equal(c.myStoredSignature,'keep');
});
