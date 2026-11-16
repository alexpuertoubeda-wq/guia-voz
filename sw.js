// Paso Firme: caché para instalar y abrir sin conexión, y cabeceras de aislamiento
// (necesarias para que el medidor de profundidad use varios núcleos del móvil).
const CACHE = 'paso-firme-v14';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'tf.min.js', 'coco-ssd.min.js', 'lectura.js', 'rutas.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('paso-firme-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
function isolate(res) {
  if (!res || res.status === 0 || res.type === 'opaque') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  h.set('Cross-Origin-Resource-Policy', 'cross-origin');
  const nobody = res.status === 204 || res.status === 304;
  return new Response(nobody ? null : res.body, { status: res.status, statusText: res.statusText, headers: h });
}
// Red primero; si falla, lo guardado. Solo se gestionan los archivos propios:
// los modelos y librerías externas los guarda el navegador por su cuenta.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    // 'no-cache' obliga a comprobar con el servidor: así cada apertura trae la última versión.
    fetch(req.url, { cache: 'no-cache' }).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
      return isolate(res);
    }).catch(() => caches.match(req).then(r => r ? isolate(r) : Response.error()))
  );
});
