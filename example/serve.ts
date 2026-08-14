import { resolveStaticAsset } from "./static-path";
import { createRuntimeSyncKey } from "./sync-key";

const port = Number(Bun.env.PORT ?? 4173);
const root = new URL("./dist/", import.meta.url);
const syncKey = createRuntimeSyncKey();

const runtimeSyncResponse = (request: Request): Response | undefined =>
  new URL(request.url).pathname === "/sync-key"
    ? syncKey
      ? new Response(syncKey, {
          headers: {
            "cache-control": "no-store",
            "content-type": "text/plain",
          },
        })
      : new Response("Synchronization is disabled.", { status: 404 })
    : undefined;

const staticAssetResponse = async (request: Request): Promise<Response> => {
  const assetUrl = resolveStaticAsset(request.url, root);
  if (!assetUrl) return new Response("Not found", { status: 404 });
  const asset = Bun.file(assetUrl);
  return (await asset.exists())
    ? new Response(asset)
    : new Response("Not found", { status: 404 });
};

const server = Bun.serve({
  async fetch(request) {
    return runtimeSyncResponse(request) ?? (await staticAssetResponse(request));
  },
  port,
});

console.log(`nusm production example ready at ${server.url}`);
