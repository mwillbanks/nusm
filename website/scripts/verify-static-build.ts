import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const output = resolve(import.meta.dirname, "../.output/public");
const base = `${(process.env.VITE_BASE_PATH ?? "/").replace(/\/$/, "")}/`;
const index = readFileSync(resolve(output, "llms.txt"), "utf8");
const full = readFileSync(resolve(output, "llms-full.txt"), "utf8");
assert(index.startsWith("# nusm"), "The LLM index must contain rendered text");
assert(
  !index.includes("[object Promise]"),
  "The asynchronous index must be awaited",
);
assert(
  full.includes("NusmSyncSource"),
  "The full documentation must include the synchronization API",
);
const links = [...index.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]!);
const documents = [
  ...new Bun.Glob("**/*.mdx").scanSync(
    resolve(import.meta.dirname, "../content/docs"),
  ),
];
const expectedLinks = documents.map(
  (file) =>
    `${base}docs${file === "index.mdx" ? "" : `/${file.replace(/\.mdx$/, "").replace(/\/index$/, "")}`}`,
);
assert.deepEqual(
  [...links].sort(),
  expectedLinks.sort(),
  "The index must include every documentation page",
);
for (const link of links) {
  assert(
    link.startsWith(`${base}docs`),
    `Documentation link lost its base path: ${link}`,
  );
  const path = link.slice(base.length);
  assert(
    existsSync(resolve(output, path, "index.html")),
    `Missing rendered documentation: ${link}`,
  );
}
assert(
  existsSync(resolve(output, "api/search")),
  "The static search endpoint must exist",
);
console.log(
  `Verified ${links.length} documentation links, LLM output, and static search`,
);
