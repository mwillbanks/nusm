import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import metadata from "../package.json";

const root = resolve(import.meta.dirname, "..");
const bun = process.execPath;
const node = process.env.NUSM_PACK_NODE ?? "node";
const chrome =
  process.env.NUSM_PACK_CHROME ??
  Bun.which("google-chrome") ??
  Bun.which("chromium") ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function run(cwd: string, command: string[]): string {
  const result = Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, HUSKY: "0", NODE_ENV: "production" },
    stderr: "pipe",
    stdout: "pipe",
    timeout: 120_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      [command.join(" "), result.stderr.toString(), result.stdout.toString()]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result.stdout.toString().trim();
}

async function install(
  directory: string,
  archive: string,
  dependencies: Record<string, string> = {},
) {
  await mkdir(directory);
  await Bun.write(
    join(directory, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { ...dependencies, nusm: `file:${archive}` },
      intent: { skills: ["nusm#nusm"] },
    }),
  );
  run(directory, [bun, "install", "--ignore-scripts", "--omit", "peer"]);
}

async function verifyBrowser(consumer: string, directory: string) {
  const report = Promise.withResolvers<string>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    routes: {
      "/": new Response(
        `<!doctype html><main></main><aside></aside><script>
        const report = (message) => fetch("/result", { method: "POST", body: message });
        window.addEventListener("error", (event) => report(event.message));
        window.addEventListener("unhandledrejection", (event) => report(String(event.reason)));
        const observer = new MutationObserver(() => {
          const count = document.querySelector("#count");
          const panel = document.querySelector(".nusm-stores");
          if (
            count?.textContent === "count 9" &&
            panel?.textContent.includes("packed-fixture") &&
            document.body.dataset.templates === "ok"
          ) {
            observer.disconnect();
            void report("ok");
          }
        });
        observer.observe(document.body, {
          subtree: true, childList: true, characterData: true, attributes: true,
        });
      </script><script type="module" src="/browser.js"></script>`,
        {
          headers: { "content-type": "text/html" },
        },
      ),
      "/browser.js": () => new Response(Bun.file(join(consumer, "browser.js"))),
      "/result": {
        POST: async (request) => {
          report.resolve(await request.text());
          return new Response(null, { status: 204 });
        },
      },
    },
    fetch: () => new Response(null, { status: 404 }),
  });
  const timeout = setTimeout(
    () =>
      report.reject(
        new Error(
          "Browser did not render the React update and shared Devtools store",
        ),
      ),
    20_000,
  );
  try {
    const process = Bun.spawn(
      [
        chrome,
        "--headless",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        `--user-data-dir=${join(directory, "chrome")}`,
        server.url.href,
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    try {
      const result = await Promise.race([
        report.promise,
        process.exited.then(
          (exitCode) => `Chrome exited with status ${exitCode}`,
        ),
      ]);
      if (result !== "ok") throw new Error(result);
    } finally {
      process.kill();
      await process.exited;
    }
  } finally {
    clearTimeout(timeout);
    server.stop(true);
  }
}

const directory = await mkdtemp(join(tmpdir(), "nusm-pack-"));
try {
  const [input, ...extra] = Bun.argv
    .slice(2)
    .filter((argument) => argument !== "--");
  if (extra.length) throw new Error("Usage: pack:check [tarball]");
  if (!input) run(root, [bun, "run", "build"]);
  const archive = input
    ? resolve(input)
    : join(
        directory,
        run(root, [
          "npm",
          "pack",
          "--ignore-scripts",
          "--pack-destination",
          directory,
        ]),
      );

  const core = join(directory, "core");
  await install(core, archive);
  if (existsSync(join(core, "node_modules/react"))) {
    throw new Error("The core fixture unexpectedly installed React");
  }
  run(core, [
    node,
    "--input-type=module",
    "--eval",
    `
      import { createNusmStore } from "nusm";
      const store = createNusmStore({ value: 1 });
      await store.ready;
      if (store.state.value !== 1) throw Error("Core store did not initialize");
      await store.dispose();
    `,
  ]);

  const consumer = join(directory, "consumer");
  const dependencies = Object.fromEntries(
    [
      "@tanstack/devtools",
      "@tanstack/devtools-utils",
      "@types/bun",
      "@types/react",
      "@types/react-dom",
      "lucide-react",
      "react",
      "react-dom",
    ].map((name) => [
      name,
      metadata.devDependencies[name as keyof typeof metadata.devDependencies],
    ]),
  );
  await install(consumer, archive, dependencies);
  run(consumer, [
    node,
    "--input-type=module",
    "--eval",
    `
      import { createNusmStore } from "nusm";
      import { useStore } from "nusm/react";
      import { createNusmDevtoolsPlugin } from "nusm/devtools";
      if ([createNusmStore, useStore, createNusmDevtoolsPlugin]
          .some((value) => typeof value !== "function")) {
        throw Error("Package entry points did not load");
      }
    `,
  ]);

  const modules = join(consumer, "node_modules/nusm");
  const installed = await Bun.file(join(modules, "package.json")).json();
  if (installed.version !== metadata.version) {
    throw new Error("The tarball version differs from the checkout");
  }
  if (existsSync(join(modules, "skills/_artifacts"))) {
    throw new Error("The npm archive contains Intent maintainer records");
  }
  const intent = [node, join(root, "node_modules/.bin/intent")];
  const listed = JSON.parse(run(consumer, [...intent, "list", "--json"])) as {
    skills: Array<{ use: string; packageVersion: string }>;
  };
  const matched = listed.skills.filter(({ use }) => use === "nusm#nusm");
  if (matched.length !== 1 || matched[0]?.packageVersion !== metadata.version) {
    throw new Error("Intent did not discover the version-matched nusm skill");
  }
  const skill = join(modules, "skills/nusm");
  const loaded = run(consumer, [...intent, "load", "nusm#nusm", "--path"]);
  if (
    (await realpath(resolve(consumer, loaded))) !==
    (await realpath(join(skill, "SKILL.md")))
  ) {
    throw new Error("Intent loaded a different skill");
  }

  await Bun.write(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx",
        module: "Preserve",
        moduleResolution: "Bundler",
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        types: ["bun", "react", "react-dom"],
      },
    }),
  );
  await Bun.write(
    join(consumer, "browser.tsx"),
    `
      import { createNusmStore } from "nusm";
      import { useStore } from "nusm/react";
      import { NusmReactDevtoolsPanel } from "nusm/devtools";
      import { TanStackDevtoolsCore } from "@tanstack/devtools";
      import { flushSync } from "react-dom";
      import { createRoot } from "react-dom/client";
      import {
        createPreferencesStore,
        PreferencesToggle,
      } from "./node_modules/nusm/skills/nusm/assets/persisted-store.js";
      import { createSharedCounter } from "./node_modules/nusm/skills/nusm/assets/synchronized-store.js";

      const devtools = new TanStackDevtoolsCore({ plugins: [] });
      devtools.mount(document.querySelector("aside")!);
      const store = createNusmStore({ count: 8 }, { devtools: true, storeId: "packed-fixture" });

      function Counter() {
        const count: number = useStore(store, (state) => state.count);
        return <output id="count">count {count}</output>;
      }

      const preferences = createPreferencesStore();
      await preferences.ready;
      const root = createRoot(document.querySelector("main")!);
      flushSync(() => root.render(
        <>
          <Counter />
          <div id="preferences"><PreferencesToggle store={preferences} /></div>
          <NusmReactDevtoolsPanel theme="light" devtoolsOpen={true} />
        </>,
      ));
      flushSync(() => store.setState((state) => ({ count: state.count + 1 })));
      flushSync(() => document.querySelector<HTMLButtonElement>("#preferences button")!.click());
      if (!preferences.state.compact) throw Error("Persisted template did not update");
      await preferences.dispose();
      const restored = createPreferencesStore();
      await restored.ready;
      if (!restored.state.compact) throw Error("Persisted template did not restore");
      await restored.dispose();

      const key = await crypto.subtle.generateKey(
        { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
      );
      const first = createSharedCounter("packed-skill", key);
      const second = createSharedCounter("packed-skill", key);
      const shared = Promise.withResolvers<void>();
      try {
        await Promise.all([first.ready, second.ready]);
        const subscription = second.subscribe((state) => {
          if (state.count === 1) shared.resolve();
        });
        first.setState(() => ({ count: 1 }));
        await shared.promise;
        subscription.unsubscribe();
      } finally {
        await Promise.all([first.dispose(), second.dispose()]);
      }
      document.body.dataset.templates = "ok";
    `,
  );
  run(consumer, [
    bun,
    "check",
    "browser.tsx",
    join(skill, "assets/persisted-store.tsx"),
    join(skill, "assets/synchronized-store.ts"),
    join(skill, "scripts/check-adapter.ts"),
  ]);
  const adapter = `
    import { checkAdapter } from ${JSON.stringify(pathToFileURL(join(skill, "scripts/check-adapter.ts")).href)};
    const state = new Map();
    await checkAdapter({
      name: "memory",
      getItem: (key) => state.get(key) ?? null,
      setItem: (key, value) => { state.set(key, value); },
      removeItem: (key) => { state.delete(key); },
    }, "nusm:pack-check");
    if (state.size) throw Error("Adapter check did not clean up");
  `;
  run(consumer, [bun, "--eval", adapter]);

  run(consumer, [
    bun,
    "build",
    "--target=browser",
    "--format=esm",
    "--production",
    "--outfile=browser.js",
    "./browser.tsx",
  ]);
  await verifyBrowser(consumer, directory);
  console.log(
    "Verified Node ESM, browser runtime, declarations, and packaged Intent skill",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
