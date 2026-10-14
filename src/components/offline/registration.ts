export async function prepareOfflineShell() {
  if (!isSecureContext || !("serviceWorker" in navigator))
    throw new Error(
      "Offline reopening requires HTTPS and service-worker support.",
    );
  const registration = await navigator.serviceWorker.register("/driver-sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  await navigator.serviceWorker.ready;
  const worker = registration.active;
  if (!worker)
    throw new Error(
      "Offline application setup is incomplete. Reconnect and retry.",
    );
  const shell = await fetch("/offline", { cache: "no-store" });
  if (!shell.ok)
    throw new Error(
      "Offline application setup is incomplete. Reconnect and retry.",
    );
  const html = await shell.text();
  const document = new DOMParser().parseFromString(html, "text/html");
  const resources = [
    ...new Set(
      [
        ...performance.getEntriesByType("resource").map((r) => r.name),
        ...Array.from(document.querySelectorAll("script[src],link[href]")).map(
          (n) =>
            new URL(
              n.getAttribute("src") ?? n.getAttribute("href")!,
              location.origin,
            ).href,
        ),
      ].filter(
        (u) =>
          new URL(u).origin === location.origin &&
          new URL(u).pathname.startsWith("/_next/static/"),
      ),
    ),
  ];
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel(),
      timeout = setTimeout(
        () =>
          reject(
            new Error(
              "Offline application setup is incomplete. Reconnect and retry.",
            ),
          ),
        30000,
      );
    channel.port1.onmessage = (e) => {
      clearTimeout(timeout);
      channel.port1.close();
      if (e.data?.ready) resolve();
      else
        reject(
          new Error(
            "Offline application setup is incomplete. Reconnect and retry.",
          ),
        );
    };
    worker.postMessage({ kind: "PREPARE", resources }, [channel.port2]);
  });
}
