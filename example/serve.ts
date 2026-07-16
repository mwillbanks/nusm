import { resolveStaticAsset } from "./static-path";

const port = Number(Bun.env.PORT ?? 4173);
const root = new URL("./dist/", import.meta.url);

const server = Bun.serve({
  async fetch(request) {
    const assetUrl = resolveStaticAsset(request.url, root);
    if (!assetUrl) return new Response("Not found", { status: 404 });
    const asset = Bun.file(assetUrl);
    if (await asset.exists()) return new Response(asset);
    return new Response("Not found", { status: 404 });
  },
  port,
});

console.log(`nusm production example ready at ${server.url}`);
