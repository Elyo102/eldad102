// Administrator-only account approval and reversible association to an existing sheet.
function appUserControls(u) {
  if(!state.isAdmin || !u.appManaged)return '';
  return `<div style="width:100%;margin-top:10px">
    <strong>${u.pendingApproval ? 'ממתין לאישור מנהל' : u.appOnly ? 'משתמש אפליקציה בלבד' : 'משויך לשיטס'}</strong>
    ${u.pendingApproval ? `<button type="button" class="tool-btn app-approve" data-code="${escapeHtml(u.code)}">אשר משתמש</button>` : ''}
    <label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" style="width:20px;height:20px;flex:none" class="app-sheet-link" data-code="${escapeHtml(u.code)}" ${u.appOnly?'':'checked'} ${u.pendingApproval?'disabled':''}> שייך לשיטס</label>
    <input class="app-sheet-name" data-code="${escapeHtml(u.code)}" aria-label="שם לשונית קיימת בשיטס" placeholder="שם לשונית קיימת בשיטס" value="${escapeHtml(u.linkedSheetName||u.name||'')}" style="max-width:100%;box-sizing:border-box">
    <small style="display:block">השיוך דורש לשונית קיימת בשם המשתמש. הדיווחים נשמרים גם בביטול השיוך.</small>
  </div>`;
}
$('admin-users-list').addEventListener('click',async e=>{
  const button=e.target.closest('.app-approve');if(!button)return;
  button.disabled=true;
  try{const r=await apiPost('adminApproveAppUser',{adminCode:state.code,targetCode:button.dataset.code});if(!r.success)throw Error(r.message||'האישור לא הושלם');showToast(r.message);await loadAdminUsers();}
  catch(err){showToast(err.message||'לא התקבל אישור. רענן את רשימת המשתמשים לפני ניסיון נוסף.');}
  finally{button.disabled=false;}
});
$('admin-users-list').addEventListener('change',async e=>{
  const checkbox=e.target.closest('.app-sheet-link');if(!checkbox)return;
  const linked=checkbox.checked;
  const input=checkbox.closest('.shift-card').querySelector('.app-sheet-name');
  checkbox.disabled=true;
  try{const r=await apiPost('adminSetSheetLink',{adminCode:state.code,targetCode:checkbox.dataset.code,linked,sheetName:input.value.trim()});if(!r.success)throw Error(r.message||'השיוך לא הושלם');showToast(r.message);await loadAdminUsers();}
  catch(err){checkbox.checked=!linked;showToast(err.message||'לא התקבל אישור לשיוך. רענן את רשימת המשתמשים.');}
  finally{checkbox.disabled=false;}
});
$('app-user-create-form').addEventListener('submit',async e=>{
  e.preventDefault();const button=e.target.querySelector('button[type=submit]');button.disabled=true;
  const result=$('app-user-create-result');result.textContent='שומר בקשת הצטרפות…';
  try{const r=await apiPost('adminCreateAppUser',{adminCode:state.code,firstName:$('app-user-first').value.trim(),lastName:$('app-user-last').value.trim(),email:$('app-user-email').value.trim()});if(!r.success)throw Error(r.message||'הבקשה לא נשמרה');result.textContent=r.message;await loadAdminUsers();}
  catch(err){result.textContent=err.message||'לא התקבל אישור שמירה. בדוק את רשימת המשתמשים לפני ניסיון נוסף.';}
  finally{button.disabled=false;}
});
