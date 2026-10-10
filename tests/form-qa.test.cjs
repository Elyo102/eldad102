const fs=require('fs'),vm=require('vm'),test=require('node:test'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../app.js','utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
function setup(){
 const els={},calls=[],c={state:{code:'a',editingDateStr:'2026-10-05'},shiftFormSubmitting:false,pendingReportOperation:null,crypto:{randomUUID:()=> 'op'},LOCKED_START_TIME:{},FIXED_HOUR_TYPES:new Set(),REQUIRE_JUSTIFICATION_TYPES:new Set(),confirm:()=>true,showToast(){},closeShiftModal(){},applyConfirmedHoursMutation:()=>true,refreshMonth(){},acknowledgeHoursSave(){},callApi:async(...args)=>{calls.push(args);return {success:true};},$:id=>els[id]||(els[id]={value:'',classList:{add(){},remove(){}},addEventListener:(ev,fn)=>els[id][ev]=fn})};
 vm.createContext(c);
 vm.runInContext(section("$('shift-form').addEventListener('submit'",'// Apply only the canonical'),c);
 vm.runInContext(section('let deletingShift = false;', '// ---------------------------------------------------------------------'),c);
 for(const [id,value] of Object.entries({'shift-date':'2026-10-05','shift-daytype':'משמרת מפוצלת','shift-start':'05:00','shift-end':'07:00'}))c.$(id).value=value;
 return {c,els,calls,save:()=>els['shift-form'].submit({preventDefault(){}}),del:()=>els['delete-shift-btn'].click()};
}
test('single short split segment reaches server without a second segment',async()=>{const f=setup();await f.save();assert.equal(f.calls.length,1);assert.equal(f.calls[0][1],'saveHoursReport');assert.equal(f.calls[0][2].startTime,'05:00');assert.equal(f.calls[0][2].entry2,'');});
test('partial second segment cannot be submitted',async()=>{for(const id of ['shift-start2','shift-end2']){const f=setup();f.c.$(id).value='12:00';await f.save();assert.equal(f.calls.length,0);assert.match(f.els['shift-form-error'].textContent,/שניהם ריקים/);}});
test('save and delete exclude each other in either order, and recover after completion',async()=>{for(const first of ['save','del']){const f=setup();let done;f.c.callApi=async(...args)=>{f.calls.push(args);return new Promise(r=>done=r);};const pending=f[first]();await f[first==='save'?'del':'save']();assert.equal(f.calls.length,1);done({success:true});await pending;f.c.callApi=async(...args)=>{f.calls.push(args);return {success:true};};await f.save();assert.equal(f.calls.length,2);}});
test('HTML escaping protects both text content and quoted document attributes',()=>{const c={};vm.createContext(c);vm.runInContext(section('function escapeHtml(', '// ממיר File'),c);assert.equal(c.escapeHtml('<img src=x onerror="bad()"> &'), '&lt;img src=x onerror=&quot;bad()&quot;&gt; &amp;');assert.equal(c.escapeHtml('שם "מסמך"'), 'שם &quot;מסמך&quot;');assert.equal(c.escapeHtml(26),'26');});
