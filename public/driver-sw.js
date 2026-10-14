// Only public shell/static assets. Never cache authenticated HTML, API data,
// Supabase responses, POST requests, invoices or administrative pages.
const CACHE = "mount-kailash-shell-v2";
async function prepare(resources = []) {
  const cache = await caches.open(CACHE);
  const shell = await fetch(new Request("/offline", { cache: "reload" }));
  if (!shell.ok) throw new Error("Shell unavailable");
  const html = await shell.clone().text();
  const assets = new Set([
    ...resources,
    ...Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g), (m) => m[1]),
  ]);
  for (const resource of assets) {
    const url = new URL(resource, self.location.origin);
    if (
      url.origin !== self.location.origin ||
      !url.pathname.startsWith("/_next/static/")
    )
      continue;
    const response = await fetch(new Request(url, { cache: "reload" }));
    if (!response.ok) throw new Error("Asset unavailable");
    await cache.put(url, response);
  }
  // Replace the shell only after its new assets are durable. Keep old assets
  // for already-open tabs; this cache never owns/deletes the business database.
  await cache.put("/offline", shell);
}
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await prepare();
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      for (const client of await self.clients.matchAll())
        client.postMessage({ kind: "SHELL_UPDATED" });
    })(),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.kind !== "PREPARE") return;
  event.waitUntil(
    (async () => {
      try {
        await prepare(event.data.resources ?? []);
        event.ports[0]?.postMessage({ ready: true });
      } catch {
        event.ports[0]?.postMessage({ ready: false });
      }
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok)
            await (await caches.open(CACHE)).put(request, response.clone());
          return response;
        } catch {
          return (await caches.match(request)) ?? Response.error();
        }
      })(),
    );
  } else if (
    request.mode === "navigate" &&
    (url.pathname === "/offline" ||
      url.pathname.startsWith("/driver/") ||
      url.pathname === "/" ||
      url.pathname === "/sign-in")
  ) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          return response;
        } catch {
          // Older application caches may still exist for open tabs. Always
          // reopen with this worker's shell, which understands trusted PINs.
          return (
            (await (await caches.open(CACHE)).match("/offline")) ??
            Response.error()
          );
        }
      })(),
    );
  }
});
