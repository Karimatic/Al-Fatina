/* Al Fatina service worker: notifications (back in stock, store news), and saved copies
 * for flaky mobile networks (audit REL-3).
 *  - Public pages (home, shop, categories, products, info pages): network first, 4 s at most;
 *    no answer → the copy saved last time she opened that page (marked with a Server-Timing
 *    "saved" header), else the offline page. Never saved: cart, checkout, thank-you, tracking,
 *    favourites, the admin, the short links.
 *  - The catalogue data those pages read (/api/site, /catalog, /categories, /products/…,
 *    /reviews…): the same rule, each address saved apart. Prices in a saved copy can be old:
 *    the order is always priced again by the server, and ordering needs the network anyway.
 *  - Built scripts and styles (/assets: their names change with their content): kept as they are
 *    (the last 120).
 * Every other request (orders, forms, the admin) goes straight to the network, untouched. */

const OFFLINE = "elfatina-offline-v3";
const PAGES = "elfatina-pages-v1";
const DATA_CACHE = "elfatina-data-v1";
const FILES = "elfatina-files-v1";
const KEEP = [OFFLINE, PAGES, DATA_CACHE, FILES];
const WAIT_MS = 4000;
const MAX_SAVED = { [PAGES]: 40, [DATA_CACHE]: 60, [FILES]: 120 };

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(OFFLINE).then((c) => c.addAll(["/offline", "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

const PRIVATE = /^\/(fr\/)?(panier|commande|merci|suivi|favoris)(\/|$)|^\/(admin|l)(\/|$)/;
const DATA = /^\/api\/(site|catalog|categories|products\/|reviews|collections\/|pages\/|geo\/)/;
const BUILT = /^\/assets\//;

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), ms));
}

/** the network within WAIT_MS (a copy is kept), else the saved copy */
async function networkFirst(req, cacheName, fallback) {
  const cache = await caches.open(cacheName);
  const network = fetch(req).then(async (res) => {
    if (res.ok && res.status === 200) {
      await cache.put(req, res.clone());
      trim(cache, cacheName);
    }
    return res;
  });
  try {
    return await Promise.race([network, timeout(WAIT_MS)]);
  } catch {
    const saved = await cache.match(req, { ignoreSearch: cacheName === PAGES });
    if (saved) {
      const headers = new Headers(saved.headers);
      headers.set("Server-Timing", 'sw;desc="saved"');
      return new Response(saved.body, { status: saved.status, headers });
    }
    // nothing saved: wait for the network after all, then the offline page
    try {
      return await network;
    } catch {
      return fallback ? (await caches.match(fallback)) || Response.error() : Response.error();
    }
  }
}

/** oldest first out, so the phone's storage stays small */
async function trim(cache, name) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SAVED[name]))) await cache.delete(k);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    if (PRIVATE.test(url.pathname)) {
      event.respondWith(fetch(req).catch(() => caches.match("/offline")));
      return;
    }
    event.respondWith(networkFirst(req, PAGES, "/offline"));
    return;
  }
  if (DATA.test(url.pathname)) {
    event.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }
  if (BUILT.test(url.pathname)) {
    event.respondWith(
      caches.open(FILES).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone()).then(() => trim(cache, FILES));
        return res;
      }),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Al Fatina ✨", {
      body: data.body || "",
      icon: data.icon || "/icons/icon-192.png",
      image: data.icon || undefined,
      badge: "/icons/favicon-32.png",
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // only ever a page of this shop, whatever the notification carries
  let url = (event.notification.data && event.notification.data.url) || "/";
  try {
    const u = new URL(url, self.location.origin);
    url = u.origin === self.location.origin ? u.href : "/";
  } catch {
    url = "/";
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
