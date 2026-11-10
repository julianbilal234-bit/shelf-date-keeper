// Shelf Date Keeper: works offline and sends a daily expiry alert.
const CACHE = "shelf-dates-v5";
const CORE = ["./", "index.html", "manifest.json", "expiry-icon-192.png", "expiry-icon-512.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (/openfoodfacts|openproductsfacts/.test(e.request.url)) return; // product lookups are never stored
  const same = new URL(e.request.url).origin === self.location.origin;
  e.respondWith(
    (same ? fetch(e.request.url, { cache: "no-cache" }) : fetch(e.request)).then(r => {
      const copy = r.clone();
      if (r.ok || r.type === "opaque") caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then(r => r || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});

/* ---- daily alert ---- */
function idb() { return new Promise((res, rej) => { const r = indexedDB.open("sdk", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function get(k) { const d = await idb(); return new Promise(res => { const r = d.transaction("kv").objectStore("kv").get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); }); }
async function set(k, v) { const d = await idb(); return new Promise(res => { const t = d.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = res; t.onerror = res; }); }
function today() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function daysLeft(exp) { const [y, m, d] = exp.split("-").map(Number); const t = new Date(); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / 864e5); }
function label(n) { return n < 0 ? "expired " + (-n) + "d ago" : n === 0 ? "expires today" : n === 1 ? "1 day left" : n + " days left"; }
async function dailyCheck() {
  if (self.Notification && Notification.permission !== "granted") return;
  if ((await get("lastAlert")) === today()) return;
  const data = await get("list"); if (!data || !data.items) return;
  const days = (data.remind && data.remind.days) || [];
  const list = data.items.filter(i => i.expiry && (daysLeft(i.expiry) < 0 || days.includes(daysLeft(i.expiry)))).sort((a, b) => a.expiry.localeCompare(b.expiry));
  if (!list.length) return;
  const lines = list.slice(0, 6).map(i => i.description + ": " + label(daysLeft(i.expiry)));
  if (list.length > 6) lines.push("+" + (list.length - 6) + " more");
  await self.registration.showNotification(list.length + " item" + (list.length > 1 ? "s" : "") + " to check", { body: lines.join("\n"), icon: "expiry-icon-192.png", badge: "expiry-icon-192.png", tag: "expiry" });
  await set("lastAlert", today());
}
self.addEventListener("periodicsync", e => { if (e.tag === "expiry-check") e.waitUntil(dailyCheck()); });
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow("./")));
});
