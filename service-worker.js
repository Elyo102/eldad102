/* =====================================================================
 *  service-worker.js — "דוח נוכחות כבאים"
 *  שומר במטמון את קבצי המעטפת (HTML/CSS/JS/אייקונים) כדי שהאפליקציה
 *  תיפתח מהר גם ברשת חלשה. קריאות ה-API (script.google.com) תמיד
 *  הולכות ישירות לרשת - לא נשמרות במטמון, כי אלה נתונים חיים.
 *
 *  בנוסף: מטפל בהתראות Push (Firebase Cloud Messaging) שמגיעות גם
 *  כשהאפליקציה סגורה לגמרי - זו הסיבה שחייבים לטעון את Firebase כאן,
 *  לא רק ב-app.js (ש"ישן" ברקע כשהאפליקציה סגורה).
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
  const title = (payload.notification && payload.notification.title) || 'דוח נוכחות כבאים';
  const body = (payload.notification && payload.notification.body) || '';
  self.registration.showNotification(title, {
    body: body,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png'
  });
});

const CACHE_NAME = 'ds102-shell-v21';
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
