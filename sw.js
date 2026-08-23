/* Service worker: A2HS + local notifications for TNIT. */

function iconUrl() {
  try {
    return new URL('./assets/heart.png', self.location.href).href;
  } catch (_) {
    return './assets/heart.png';
  }
}

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type !== 'tnit-notify') return;
  const title = msg.title || 'TNIT';
  const options = {
    body: msg.body || '',
    icon: msg.icon || iconUrl(),
    badge: msg.icon || iconUrl(),
    tag: msg.tag || 'tnit-local',
    renotify: true,
    data: { url: msg.url || './', tag: msg.tag || 'tnit-local' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if ('focus' in client) {
        await client.focus();
        if (client.navigate && rawUrl) {
          try { await client.navigate(rawUrl); } catch (_) { /* ignore */ }
        }
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(rawUrl);
  })());
});

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
