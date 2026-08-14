import app from "./src/index.html";
import { createRuntimeSyncKey } from "./sync-key";

const port = Number(Bun.env.PORT ?? 4173);
const syncKey = createRuntimeSyncKey();
const server = Bun.serve({
  development:
    Bun.env.NODE_ENV !== "production" ? { console: true, hmr: true } : false,
  port,
  routes: {
    "/*": app,
    "/sync-key": () =>
      syncKey
        ? new Response(syncKey, {
            headers: {
              "cache-control": "no-store",
              "content-type": "text/plain",
            },
          })
        : new Response("Synchronization is disabled.", { status: 404 }),
  },
});

console.log(`nusm example ready at ${server.url}`);
