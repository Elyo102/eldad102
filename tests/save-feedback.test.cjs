const fs=require('fs'),vm=require('vm'),test=require('node:test'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../app.js','utf8');
const start=source.indexOf('const recentHoursSaves = new Map();'),end=source.indexOf('let monthLoadSequence = 0;',start);
function fixture(){const badges=[];const c={Date,Map,JSON,state:{code:'a'},document:{querySelectorAll:()=>[],createElement:()=>({})}};vm.createContext(c);vm.runInContext(source.slice(start,end),c);const card={dataset:{},classList:{add(){}},querySelector:()=>({appendChild:e=>badges.push(e)})};return{c,card,badges};}
const entry={id:'operation',params:{code:'a',dateStr:'2026-09-08'}};
function decorate(f,verified=true){f.c.decorateHoursSavedCard(f.card,{dateStr:'2026-09-08'},verified);}
test('failed or uncertain save never highlights the report',()=>{const f=fixture();f.c.acknowledgeHoursSave(entry,null);f.c.acknowledgeHoursSave(entry,{success:false});decorate(f);assert.equal(f.badges.length,0);});
test('acknowledged save highlights the refreshed report',()=>{const f=fixture();f.c.acknowledgeHoursSave(entry,{success:true});decorate(f);assert.equal(f.badges[0].textContent,'✓ השינוי נשמר');});
test('another account acknowledgement cannot highlight current report',()=>{const f=fixture();f.c.acknowledgeHoursSave({...entry,params:{...entry.params,code:'b'}},{success:true});decorate(f);assert.equal(f.badges.length,0);});
test('new edit removes previous acknowledgement',()=>{const f=fixture();f.c.acknowledgeHoursSave(entry,{success:true});f.c.clearHoursSaveFeedback('2026-09-08');decorate(f);assert.equal(f.badges.length,0);});
test('cached row cannot be marked as refreshed after save',()=>{const f=fixture();f.c.acknowledgeHoursSave(entry,{success:true});decorate(f,false);assert.equal(f.badges.length,0);});
