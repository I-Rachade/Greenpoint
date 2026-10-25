// Push notices of the web app (worker/web-push.ts sends them, src/lib/web-push.ts signs up).
// The payload is { title, body, path }; tapping the notice opens that page of the app.

// Take over open pages at once, so a tapped notice can move them to its page.
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let notice = {};
  try {
    notice = event.data ? event.data.json() : {};
  } catch {
    notice = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(notice.title || "poinderecharge", {
      body: notice.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { path: typeof notice.path === "string" && notice.path.startsWith("/") ? notice.path : "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.path || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        return open.navigate(url).catch(() => self.clients.openWindow(url));
      }
      return self.clients.openWindow(url);
    })(),
  );
});
