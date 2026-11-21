// 화면 파일은 '인터넷 먼저'로 받아 항상 최신 버전을 씀 (예전엔 저장본을 먼저 보여 줘 고친 내용이 늦게 반영됐음)
// 인터넷이 끊겼을 때만 저장본을 씀. 서버(API) 호출은 건드리지 않음
const CACHE = 'study-v3';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html'))),
  );
});

// 저녁 9시 복습 알림 받기
self.addEventListener('push', (e) => {
  let d = { title: 'Study', body: '복습할 시간이에요', url: './' };
  try { d = { ...d, ...e.data.json() }; } catch { /* 글자만 온 경우 */ }
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: './icon-192.png', badge: './icon-192.png', data: { url: d.url } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.registration.scope));
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});
