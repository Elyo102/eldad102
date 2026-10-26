const fs=require('fs'),vm=require('vm'),test=require('node:test'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../app.js','utf8');
for(const role of ['user','admin','hr'])test('fresh login initializes month before account reset: '+role,()=>{
 const events=[],el={classList:{toggle(){}},textContent:''};
 const c={Date,state:{currentMonth:null},$:()=>el,document:{querySelector:()=>el},saveSession(){},resetReportAccountContext_(){events.push(c.state.currentMonth.getFullYear());},showScreen(s){events.push(s);},renderMonthFromCache:()=>false,setMonthSync(){},loadBootstrap(){},refreshUrgentCalls(){},loadShortcutsFromServer(){},startPersonalAlertsPolling(){},loadAdminUsers(){},loadOpenAlerts(){},loadCalendarEvents(){},loadPersonalAlerts(){}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function enterApp('),source.indexOf('let personalAlertsPollInterval')),c);
 c.enterApp('test','Test',role==='admin',false,'',role==='hr');
 assert.equal(events[0],new Date().getFullYear());assert.equal(events[1],role==='hr'?'screen-admin':'screen-app');
});
