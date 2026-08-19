/* =====================================================================
 *  service-worker.js — "דוח נוכחות כבאים"
 *  שומר במטמון את קבצי המעטפת (HTML/CSS/JS/אייקונים) כדי שהאפליקציה
 *  תיפתח מהר גם ברשת חלשה. קריאות ה-API (script.google.com) תמיד
 *  הולכות ישירות לרשת - לא נשמרות במטמון, כי אלה נתונים חיים.
 *
 *  בנוסף: מטפל בהתראות Push (Firebase Cloud Messaging) שמגיעות גם
 *  כשהאפליקציה סגורה לגמרי - זו הסיבה שחייבים לטעון את Firebase כאן,
 *  לא רק ב-app.js (ש"ישן" ברקע כשהאפליקציה סגורה).
 *
 *  ── תיקון הפוש הכפול ──
 *  קודם השרת שלח payload עם בלוק notification. במצב כזה הדפדפן מציג
 *  התראה בעצמו, אוטומטית, ובמקביל onBackgroundMessage הציג עוד אחת -
 *  ולכן הגיעו שתי התראות על כל הודעה.
 *  עכשיו השרת שולח data בלבד (ראה sendPushToToken_ ב-Code.gs), הדפדפן
 *  לא מציג כלום מעצמו, והקוד כאן הוא היחיד שמציג. פעם אחת.
 *  חשוב: שני הצדדים חייבים להתעדכן יחד. אם רק אחד מהם מעודכן -
 *  או שיהיו שתי התראות (ישן+ישן), או שלא תהיה אף אחת (חדש+ישן).
 * ===================================================================== */

importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

// אותו קונפיג ציבורי כמו ב-app.js - לא סודי, ראה הסבר שם.
firebase.initializeApp({
  apiKey: "AIzaSyAAknVzs43Ruk9tuEV-dziswUNK16xFdWY",
  authDomain: "fire102report.firebaseapp.com",
  projectId: "fire102report",
  storageBucket: "fire102report.firebasestorage.app",
  messagingSenderId: "306754079111",
  appId: "1:306754079111:web:7aae9e1823df2da640ab22"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};

  // הכותרת והגוף מגיעים עכשיו מ-data ולא מ-notification.
  // הנפילה לאחור ל-payload.notification נשארת בכוונה: אם מסיבה כלשהי
  // מגיעה הודעה בפורמט הישן (למשל מגרסת שרת שלא עודכנה), היא עדיין
  // תוצג ולא תיעלם בשקט.
  const title = data.title || (payload.notification && payload.notification.title) || 'דוח נוכחות כבאים';
  const body = data.body || (payload.notification && payload.notification.body) || '';
  const isUrgent = data.urgent === 'true';

  // תג ייחודי מבוסס תוכן ההתראה - שכבת הגנה נוספת. אם אותה התראה
  // בדיוק מגיעה פעמיים (למשל כמה מכשירים רשומים לאותו משתמש),
  // הדפדפן מחליף את הקיימת במקום להציג שתיים.
  const notificationTag = (title + '|' + body).slice(0, 100);

  const options = {
    body: body,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: notificationTag,
    renotify: isUrgent, // התראה דחופה תרטיט שוב גם אם דורסת קיימת
    requireInteraction: isUrgent, // נשארת על המסך עד שנוגעים בה
    data: {
      urgent: isUrgent,
      url: data.url || './'
    }
  };

  if (isUrgent) {
    options.vibrate = [300, 150, 300, 150, 300, 150, 600];
  }

  return self.registration.showNotification(title, options);
});

// לחיצה על ההתראה: מביאה לחזית טאב פתוח של האפליקציה אם יש אחד,
// ואם אין - פותחת חדש. בלי זה לחיצה על ההתראה פשוט לא עושה כלום.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'NOTIFICATION_CLICK', url: targetUrl });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

const CACHE_NAME = 'ds102-shell-v73';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// התקנה: שמירת קבצי המעטפת מראש
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

// הפעלה: ניקוי גרסאות מטמון ישנות
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// בקשות: API (Google Apps Script) - תמיד רשת ישירה, לעולם לא מהמטמון.
// קבצים סטטיים - cache-first עם נפילה חזרה לרשת, ועדכון המטמון ברקע.
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // כל תעבורת ה-API עוקפת את המטמון לחלוטין.
  // הבדיקה מכסה גם את script.googleusercontent.com - הדומיין שאליו
  // גוגל מפנה את הבקשה בפועל. קודם הוא לא נכלל, כי המחרוזת
  // 'script.google.com' אינה חלק מ-'script.googleusercontent.com',
  // ולכן תשובות API יכלו להיתפס במטמון ולחזור שגויות.
  if (url.indexOf('script.google') !== -1 ||
      url.indexOf('googleusercontent.com') !== -1 ||
      url.indexOf('googleapis.com') !== -1) {
    // לא נוגעים בבקשה בכלל - נותנים לדפדפן לטפל בה בעצמו.
    // קודם עטפנו אותה ב-fetch מחדש, וזה יכול לשבור את שרשרת
    // ההפניות של Apps Script ולהחזיר "Failed to fetch".
    return;
  }

  if (event.request.method !== 'GET') return;

  // רק בקשות מאותו מקור נשמרות במטמון. כל דבר חיצוני עובר ישירות
  // לדפדפן בלי שנתערב. ה-try חשוב: כתובות מסוימות (תוספים, blob)
  // מפילות את new URL, ושגיאה כאן שוברת כל בקשה בדף.
  try {
    if (new URL(url).origin !== self.location.origin) return;
  } catch (e) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
