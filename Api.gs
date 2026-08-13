/**
 * =====================================================================
 *  Api.gs — שכבת ה-API החדשה למערכת "דוח נוכחות כבאים"
 * =====================================================================
 *  איך מוסיפים את זה לפרויקט הקיים:
 *  1. פותחים את פרויקט ה-Apps Script (מתוך הגיליון: תוספים > Apps Script,
 *     או ישירות מ-script.google.com).
 *  2. לוחצים על "+" ליד "קבצים" ובוחרים "סקריפט" (Script), נותנים לו
 *     שם הקובץ: Api  (זה ייצור קובץ Api.gs).
 *  3. מדביקים לתוכו את כל התוכן הזה, שומרים (Ctrl+S).
 *  4. לא נוגעים בקובץ Code.gs הקיים - כל הפונקציות העסקיות
 *     (login, saveManualShift, listShifts וכו') נשארות שם בדיוק כמו שהן.
 *  5. Deploy > Manage deployments > עורכים את הפריסה הקיימת (או יוצרים
 *     חדשה) > "New version" > Deploy.
 *     חשוב: אם היה כבר Web App פרוס, צריך "גרסה חדשה" כדי שהשינויים
 *     ייכנסו לתוקף באותה כתובת /exec.
 *
 *  מה זה עושה:
 *  - doGet(e)  - פעולות קריאה בלבד (login, listShifts, getMonthlyTotal,
 *                listMonthsWithData, checkMyDataForIssues) דרך query string.
 *  - doPost(e) - כל פעולה שמשנה נתונים (saveManualShift, saveShift,
 *                clearMonth, deleteShift, recalculateUserMonth,
 *                fixMyDataIssues, registerUser, sendForgotCode,
 *                setRecoveryEmail) - מקבל גוף JSON.
 *
 *  הערה חשובה על CORS:
 *  כדי להימנע מ"preflight" (בקשת OPTIONS) שה-Apps Script לא יודע
 *  לטפל בה, החזית שולחת בקשות POST עם Content-Type: text/plain
 *  (למרות שהגוף בפועל הוא JSON). doPost כאן קורא את זה כטקסט
 *  ומפרסר בעצמו עם JSON.parse - זו הסיבה שהגישה הזו עובדת.
 * =====================================================================
 */

// ---- נקודת כניסה לבקשות GET (פעולות קריאה) --------------------------
function doGet(e) {
  try {
    var action = e.parameter.action;

    if (!action) {
      return jsonOut_({ success: false, error: 'חסר פרמטר action' });
    }

    var result;
    switch (action) {
      case 'ping':
        result = { success: true, message: 'API פעיל', time: new Date().toISOString() };
        break;

      case 'login':
        result = login(e.parameter.code);
        break;

      case 'listShifts':
        result = listShifts(e.parameter.code, e.parameter.monthKey);
        break;

      case 'getMonthlyTotal':
        result = getMonthlyTotal(e.parameter.code, e.parameter.monthKey);
        break;

      case 'listMonthsWithData':
        result = listMonthsWithData(e.parameter.code);
        break;

      case 'checkMyDataForIssues':
        result = checkMyDataForIssues(e.parameter.code);
        break;

      default:
        return jsonOut_({ success: false, error: 'פעולה לא מוכרת: ' + action });
    }

    return jsonOut_(result);
  } catch (err) {
    return jsonOut_({ success: false, error: String(err && err.message ? err.message : err) });
  }
}

// ---- נקודת כניסה לבקשות POST (פעולות כתיבה) -------------------------
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut_({ success: false, error: 'לא התקבל גוף בקשה' });
    }

    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    if (!action) {
      return jsonOut_({ success: false, error: 'חסר פרמטר action בגוף הבקשה' });
    }

    var result;
    switch (action) {
      case 'login':
        result = login(body.code);
        break;

      case 'registerUser':
        result = registerUser(body.firstName, body.lastName, body.email);
        break;

      case 'sendForgotCode':
        result = sendForgotCode(body.firstName, body.lastName);
        break;

      case 'setRecoveryEmail':
        result = setRecoveryEmail(body.code, body.email);
        break;

      case 'saveManualShift':
        // חשוב: תמיד saveManualShift ולא saveShift לפעולות שהמשתמש יוזם -
        // זה מה ששומר על סימון ה-*** בהערות (הגנה מתיקון אוטומטי).
        result = saveManualShift(
          body.code, body.dateStr, body.startTime, body.endTime,
          body.notes, body.dayType, body.workplace
        );
        break;

      case 'saveShift':
        result = saveShift(
          body.code, body.dateStr, body.startTime, body.endTime,
          body.notes, body.dayType, body.workplace
        );
        break;

      case 'clearMonth':
        result = clearMonth(body.code);
        break;

      case 'deleteShift':
        result = deleteShift(body.code, body.dateStr);
        break;

      case 'recalculateUserMonth':
        result = recalculateUserMonth(body.code, body.monthKey);
        break;

      case 'fixMyDataIssues':
        result = fixMyDataIssues(body.code);
        break;

      default:
        return jsonOut_({ success: false, error: 'פעולה לא מוכרת: ' + action });
    }

    return jsonOut_(result);
  } catch (err) {
    return jsonOut_({ success: false, error: String(err && err.message ? err.message : err) });
  }
}

// ---- עזר: פלט JSON אחיד ----------------------------------------------
function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
