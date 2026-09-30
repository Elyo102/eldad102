(function (root) {
  'use strict';
  let opened;
  const database = () => opened || (opened = new Promise((resolve,reject) => {
    const request = root.indexedDB.open('ds102-hours-safety-v1',1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts',{keyPath:'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opened=null; reject(new Error('לא ניתן לפתוח אחסון טיוטות. אין לסגור את הטופס.')); };
  }));
  const uuid = () => root.crypto.randomUUID();
  async function transaction(mode, work) {
    const db = await database();
    return new Promise((resolve,reject) => {
      const tx=db.transaction('drafts',mode), store=tx.objectStore('drafts');let result,error;
      tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(error||tx.error);tx.onabort=()=>reject(error||tx.error||new Error('שמירת הטיוטה לא הושלמה'));
      const fail=e=>{error=e;tx.abort();};
      try {work(store,v=>{result=v;},fail);} catch(e){fail(e);}
    });
  }
  const read = id => transaction('readonly',(s,done)=>{const r=s.get(id);r.onsuccess=()=>done(r.result||null);});
  function save(params, existingId, expectedVersion) {
    return transaction('readwrite',(s,done,fail)=>{
      const r=s.get(existingId||'');r.onsuccess=()=>{
        try {
          const old=r.result;
          if(old&&(old.status!=='draft'||old.params.code!==params.code))throw new Error('הדיווח כבר נשלח או שייך לחשבון אחר. יש לבדוק את מצבו.');
          if(old&&expectedVersion!==undefined&&old.version!==expectedVersion)throw new Error('הטיוטה נערכה בלשונית אחרת. פתח אותה מחדש.');
          const entry={id:old?old.id:uuid(),params:{...params},status:'draft',version:(old?old.version:0)+1,createdAt:old?old.createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
          s.put(entry);done(entry);
        }catch(e){fail(e);}
      };
    });
  }
  function mark(id,status,message) {
    return transaction('readwrite',(s,done,fail)=>{const r=s.get(id);r.onsuccess=()=>{const e=r.result;if(!e){fail(new Error('הטיוטה אינה זמינה. לא תבוצע שליחה חוזרת.'));return;}if(e.status==='confirmed'&&status!=='confirmed'){done(e);return;}const next={...e,status,message:message||'',leaseUntil:0,version:e.version+1,updatedAt:new Date().toISOString()};s.put(next);done(next);};});
  }
  async function migrateLegacy() {
    const rows=[];
    for(let i=0;i<root.localStorage.length;i++) {
      const key=root.localStorage.key(i);
      if(key&&key.startsWith('ds102_durable_draft_v1_')){const e=JSON.parse(root.localStorage.getItem(key));if(!e||!e.id||!e.params)throw new Error('טיוטה פגומה נשמרה במקור. אין לנקות נתוני אתר.');rows.push({...e,version:e.version||1,status:e.status==='confirmed'?'confirmed':e.status==='draft'?'draft':'review'});}
    }
    const legacy=JSON.parse(root.localStorage.getItem('ds102_offline_queue')||'[]');
    if(!Array.isArray(legacy))throw new Error('התור הישן לא ניתן לקריאה. המקור נשמר ללא שינוי.');
    for(const item of legacy){const raw=JSON.stringify(item);const digest=await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));const id='legacy-'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');if(!item.params)throw new Error('דיווח ישן ללא פרטים. המקור נשמר.');rows.push({id,params:item.params,status:'review',version:1,createdAt:item.queuedAt||new Date().toISOString(),legacy:true});}
    await transaction('readwrite',(s,done)=>{rows.forEach(e=>{const r=s.get(e.id);r.onsuccess=()=>{if(!r.result)s.put(e);};});done(rows.length);});
    // Source keys are intentionally retained. A receipt, not migration, resolves an item.
  }
  async function pending(code,month) {
    await migrateLegacy();
    const rows=await transaction('readonly',(s,done)=>{const r=s.getAll();r.onsuccess=()=>done(r.result);});
    return rows.filter(e=>e.params.code===code&&!['confirmed','superseded'].includes(e.status)&&(!month||String(e.params.dateStr).startsWith(month))).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  }
  function stage(id,revision) {
    return transaction('readwrite',(s,done,fail)=>{const r=s.get(id);r.onsuccess=()=>{const e=r.result;if(!e||e.status!=='draft'||!/^[a-f0-9]{64}$/.test(revision||'')){fail(new Error('יש לרענן את החודש ולבדוק את הדיווח לפני השליחה. הטיוטה נשמרה.'));return;}const next={...e,status:'queued',expectedRevision:revision,version:e.version+1};s.put(next);done(next);};});
  }
  function claim(id) {
    return transaction('readwrite',(s,done)=>{const r=s.get(id);r.onsuccess=()=>{const e=r.result;if(!e||!['queued','uncertain','sending'].includes(e.status)||(e.leaseUntil||0)>Date.now()){done(null);return;}const next={...e,status:'sending',needsReceiptCheck:e.status!=='queued',leaseUntil:Date.now()+90000,version:e.version+1};s.put(next);done(next);};});
  }
  function forkForReview(id,params) {
    return transaction('readwrite',(s,done,fail)=>{const r=s.get(id);r.onsuccess=()=>{const old=r.result;if(!old||old.params.code!==params.code||(old.leaseUntil||0)>Date.now()){fail(new Error('הדיווח עדיין בשליחה או שאינו שייך לחשבון.'));return;}const next={id:uuid(),params:{...params},status:'draft',version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),sourceDraft:id};s.put({...old,status:'superseded',version:old.version+1});s.put(next);done(next);};});
  }
  root.HoursSafety={save,mark,pending,read,stage,claim,forkForReview,migrateLegacy};
})(globalThis);
