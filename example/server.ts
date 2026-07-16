import app from "./src/index.html";

const port = Number(Bun.env.PORT ?? 4173);
const server = Bun.serve({
  development:
    Bun.env.NODE_ENV !== "production" ? { console: true, hmr: true } : false,
  port,
  routes: { "/*": app },
});

console.log(`nusm example ready at ${server.url}`);
