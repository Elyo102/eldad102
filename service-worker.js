/* =====================================================================
 *  service-worker.js — "דוח נוכחות כבאים"
 *  שומר במטמון את קבצי המעטפת (HTML/CSS/JS/אייקונים) כדי שהאפליקציה
 *  תיפתח מהר גם ברשת חלשה. קריאות ה-API (script.google.com) תמיד
 *  הולכות ישירות לרשת - לא נשמרות במטמון, כי אלה נתונים חיים.
 * ===================================================================== */

const CACHE_NAME = 'ds102-shell-v4';
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
