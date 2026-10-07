/* Admin bulk import: sequential per-user requests, no reset and no automatic retry. */
let allRosterRunning = false;
async function loadRosterForEveryone() {
  if(allRosterRunning || !state.isAdmin || state.viewAs)return;
  const code=state.code,box=$('admin-roster-results'),button=$('admin-roster-load');
  if(!confirm('לטעון את החודש הנוכחי לכל הכבאים הפעילים? יתווספו רק משמרות חסרות. דיווחים ידניים וחודשים קודמים יישמרו.'))return;
  allRosterRunning=true;button.disabled=true;box.hidden=false;box.textContent='בודק את רשימת המשתמשים…';
  const lines=[];let added=0,checked=0,failed=0;
  try {
    if(getOfflineQueue().length || pendingReportOperation || shiftFormSubmitting)throw Error('יש להשלים דיווחים ממתינים לפני הטעינה');
    const targets=await callApi('GET','adminScheduleImportTargets',{code});
    if(!targets.success || !Array.isArray(targets.users))throw Error('לא התקבלה רשימת משתמשים');
    for(const user of targets.users){
      if(state.code!==code || !state.isAdmin)throw Error('הטעינה נעצרה עקב שינוי חשבון. המשמרות שכבר נטענו נשמרו.');
      box.textContent='חודש '+targets.monthKey+' — '+checked+'/'+targets.users.length+'\nבודק: '+user.name+'\n'+lines.join('\n');
      const params={code,targetCode:user.code,monthKey:targets.monthKey};
      try {
        const preview=await callApi('POST','adminImportOneSchedule',{...params,preview:true});
        if(!preview.success || !preview.complete)throw Error('בדיקת הסידור לא הושלמה');
        const result=await callApi('POST','adminImportOneSchedule',{...params,preview:false});
        if(!result.success || !result.complete || !Number.isInteger(result.filled))throw Error('לא התקבל אישור מלא; אפשר להפעיל שוב להשלמת החסרים');
        added+=result.filled;
        lines.push((result.needsReview?'⚠ ':'✓ ')+user.name+': '+result.message+(result.issues?.length?' '+result.issues.join('; '):''));
      } catch(e){failed++;lines.push('✗ '+user.name+': '+e.message);}
      checked++;
    }
    box.textContent='הבדיקה הסתיימה: '+checked+' משתמשים; נוספו '+added+' משמרות; '+failed+' טעינות לא הושלמו.\n'+lines.join('\n');
  } catch(e){box.textContent=e.message+'\n'+lines.join('\n');}
  finally {allRosterRunning=false;button.disabled=false;}
}
$('admin-roster-load').addEventListener('click',loadRosterForEveryone);
$('admin-btn').addEventListener('click',()=>{$('admin-roster-tools').hidden=!state.isAdmin || !!state.viewAs;});
