/* =====================================================================
 *  service-worker.js — "דוח נוכחות כבאים"
 *  שומר במטמון את קבצי המעטפת (HTML/CSS/JS/אייקונים) כדי שהאפליקציה
 *  תיפתח מהר גם ברשת חלשה. קריאות ה-API (script.google.com) תמיד
 *  הולכות ישירות לרשת - לא נשמרות במטמון, כי אלה נתונים חיים.
 *
 *  בנוסף: מטפל בהתראות פוש (Firebase Cloud Messaging) שמגיעות כשהאפליקציה
 *  סגורה/ברקע. לא רושמים Service Worker נפרד לזה בכוונה (firebase-messaging-sw.js
 *  הנפרד שמופיע בתיעוד של Firebase) - אלא מייבאים את ה-SDK ישירות לתוך
 *  ה-Service Worker הקיים הזה, כי לדפדפן מותר SW פעיל אחד בלבד לכל מקור
 *  (origin), וזה כבר תפוס ע"י הקבצים הסטטיים למעלה.
 * ===================================================================== */

importScripts('https://www.gstatic.com/firebasejs/12.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.6.0/firebase-messaging-compat.js');

// ⚠️ חובה שיהיה זהה בדיוק ל-FIREBASE_CONFIG שבתחילת app.js - זה לא
// מייבא משם אוטומטית כי Service Worker רץ בהקשר נפרד לגמרי מהדף עצמו.
firebase.initializeApp({
  apiKey: 'AIzaSyAAknVzs43Ruk9tuEV-dziswUNK16xFdWY',
  authDomain: 'fire102report.firebaseapp.com',
  projectId: 'fire102report',
  storageBucket: 'fire102report.firebasestorage.app',
  messagingSenderId: '306754079111',
  appId: '1:306754079111:web:7aae9e1823df2da640ab22'
});

// כשההודעה מגיעה עם payload מסוג "notification" (וזה מה ש-Code.gs שולח -
// ראה sendFcmMessage_), הדפדפן מציג אותה אוטומטית לבד גם בלי הקוד הזה.
// עדיין קוראים ל-onBackgroundMessage כדי לוודא שההתנהגות עקבית בכל
// הדפדפנים, ולתת ליומן הקונסולה שורה ברורה לאבחון אם משהו לא מגיע.
try {
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    console.log('[service-worker] התראת פוש התקבלה ברקע:', payload);
  });
} catch (e) {
  // אם FIREBASE_CONFIG עדיין לא מולא (עדיין CHANGE_ME) - לא מפילים את
  // כל ה-Service Worker בגלל זה, פשוט לא יהיו התראות עד שימולא.
}

const CACHE_NAME = 'ds102-shell-v9';
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

  if (url.includes('script.google.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.method !== 'GET') return;

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
