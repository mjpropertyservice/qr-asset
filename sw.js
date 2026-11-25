/* MJ ASSET — service worker (ทำให้ติดตั้งเป็นแอปได้ และเปิดหน้าแอปได้แม้เน็ตไม่ดี)
 * หน้าเว็บของเราเอง: ดึงจากเน็ตก่อนเสมอ (ได้เวอร์ชันล่าสุด) ถ้าออฟไลน์จึงใช้ที่เก็บไว้
 * ไลบรารีจาก CDN และฟอนต์: ใช้ที่เก็บไว้ก่อน (ไม่เปลี่ยน)
 * ข้อมูลทรัพย์สิน/ล็อกอิน (Apps Script) และรูปจาก Google Drive: ไม่เก็บ ส่งตรงทุกครั้ง */
const CACHE = 'mjasset-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const CDN = /^(https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\/)/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => null).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./'))));
    return;
  }
  if (CDN.test(req.url)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
