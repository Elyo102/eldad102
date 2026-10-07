/* The server owns the durable import; this screen only starts and observes it. */
let allRosterRunning=false, rosterPoll=null, rosterOperation=null;
function renderRosterJob(job){
  const box=$('admin-roster-results'),button=$('admin-roster-load');box.hidden=false;
  if(!job){box.textContent='אין טעינה פעילה.';button.disabled=false;return;}
  const finished=job.users.filter(u=>['done','failed'].includes(u.state)).length;
  const failed=job.users.filter(u=>u.state==='failed').length;
  const added=job.users.reduce((n,u)=>n+(u.added||0),0);
  button.disabled=job.state==='running';
  box.textContent='חודש '+job.monthKey+' — '+finished+'/'+job.users.length+' הושלמו; נוספו '+added+' משמרות. '+
    (job.state==='running'?'הטעינה מתבצעת בשרת. אפשר לצאת מהמסך.':job.state==='paused'?'הטעינה הופסקה כי התחלף החודש.':'הטעינה הסתיימה; '+failed+' לא הושלמו.')+'\n'+
    job.users.map(u=>(u.state==='done'?(u.issues.length?'⚠ ':'✓ '):u.state==='failed'?'✗ ':'◷ ')+u.name+': '+
      (u.state==='pending'?'ממתין':u.state==='running'?'בטעינה':u.state==='retry'?'ממתין לניסיון נוסף':u.message)+
      (u.issues.length?' '+u.issues.join('; '):'')).join('\n');
}
function scheduleRosterPoll(code){
  clearTimeout(rosterPoll);
  rosterPoll=setTimeout(()=>{if(state.code===code&&state.isAdmin&&!state.viewAs)refreshRosterJob();},15000);
}
async function refreshRosterJob(){
  if(!state.isAdmin||state.viewAs)return;
  const code=state.code;
  try{
    const result=await callApi('GET','getBulkRosterStatus',{code},true);
    if(state.code!==code||!state.isAdmin||state.viewAs)return;
    renderRosterJob(result.job);
    if(result.job?.state==='running')scheduleRosterPoll(code);
  }catch(e){
    if(state.code!==code)return;
    $('admin-roster-results').hidden=false;
    $('admin-roster-results').textContent='לא ניתן לקרוא כרגע את ההתקדמות. המשימה בשרת ממשיכה; מנסה שוב. '+e.message;
    scheduleRosterPoll(code);
  }
}
async function loadRosterForEveryone(){
  if(allRosterRunning||!state.isAdmin||state.viewAs)return;
  if(!confirm('להשלים משמרות חסרות בחודש הנוכחי לכל הכבאים? דיווחים קיימים וחודשים קודמים יישמרו.'))return;
  const code=state.code,box=$('admin-roster-results'),button=$('admin-roster-load');
  allRosterRunning=true;button.disabled=true;box.hidden=false;box.textContent='מפעיל טעינה בשרת…';
  try{
    if(getOfflineQueue().length||pendingReportOperation||shiftFormSubmitting)throw Error('יש להשלים דיווחים ממתינים לפני הטעינה');
    const targets=await callApi('GET','adminScheduleImportTargets',{code},true);
    if(state.code!==code||!state.isAdmin||state.viewAs)return;
    if(!rosterOperation||rosterOperation.code!==code||rosterOperation.monthKey!==targets.monthKey)
      rosterOperation={code,monthKey:targets.monthKey,operationId:crypto.randomUUID()};
    const result=await callApi('POST','startBulkRosterImport',rosterOperation,true);
    if(state.code!==code||!state.isAdmin||state.viewAs)return;
    rosterOperation=null;renderRosterJob(result.job);
    if(result.job?.state==='running')scheduleRosterPoll(code);
  }catch(e){
    if(state.code===code){box.textContent='לא התקבל אישור הפעלה: '+e.message+' בודק אם המשימה התחילה בשרת…';scheduleRosterPoll(code);button.disabled=false;}
  }finally{allRosterRunning=false;}
}
$('admin-roster-load').addEventListener('click',loadRosterForEveryone);
$('admin-btn').addEventListener('click',()=>{
  $('admin-roster-tools').hidden=!state.isAdmin||!!state.viewAs;
  if(state.isAdmin&&!state.viewAs)refreshRosterJob();
});
