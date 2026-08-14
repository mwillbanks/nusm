import { test } from "bun:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const decoder = new TextDecoder();

const run = (command: string[]) => {
  const result = Bun.spawnSync(command, {
    cwd: repositoryRoot,
    stderr: "pipe",
    stdout: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      [decoder.decode(result.stdout), decoder.decode(result.stderr)]
        .filter(Boolean)
        .join("\n"),
    );
  }
};

test("published entry points load in plain Node ESM", () => {
  run(["bun", "run", "build"]);
  run([
    "node",
    "--input-type=module",
    "--eval",
    "const [{ createNusmStore }] = await Promise.all([import('nusm'), import('nusm/react'), import('nusm/devtools')]); const store = createNusmStore({ value: 1 }, { storeId: 'node-safe' }); await store.ready; if (store.state.value !== 1) process.exit(1); await store.dispose()",
  ]);
});
