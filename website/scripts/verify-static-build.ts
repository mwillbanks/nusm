import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { staticClient } from "fumadocs-core/search/client/orama-static";

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
  ...new Bun.Glob("**/*.{md,mdx}").scanSync(
    resolve(import.meta.dirname, "../content/docs"),
  ),
];
const expectedLinks = documents.map((file) => {
  const slug = file.replace(/\.mdx?$/, "").replace(/\/index$/, "");
  return slug === "index" ? `${base}docs` : `${base}docs/${slug}`;
});
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
  const markdown = readFileSync(resolve(output, `${path}.md`), "utf8");
  assert(
    markdown.includes(`(${link})`),
    `Missing canonical URL in Markdown export: ${link}`,
  );
}
const releases = links.filter((link) =>
  link.startsWith(`${base}docs/releases/`),
);
assert(releases.length > 0, "Published releases must appear in the LLM index");
assert(
  !index.includes("NEXT_RELEASE") && !full.includes("NEXT_RELEASE"),
  "Unreleased notes must stay out of the public docs",
);
const releaseIndex = readFileSync(
  resolve(output, "docs/releases/index.html"),
  "utf8",
);
for (const release of releases) {
  assert(
    releaseIndex.includes(`href="${release}"`),
    `The release index is missing a link to ${release}`,
  );
  assert(
    full.includes(`(${release})`),
    `Missing full LLM entry for ${release}`,
  );
}
const legacyPath = "docs/releases/1.2.0";
const legacyNotes = readFileSync(resolve(output, `${legacyPath}.md`), "utf8");
assert(
  legacyNotes.includes(
    "https://github.com/mwillbanks/nusm/compare/1.1.1...1.2.0",
  ),
  "The historical release must retain its comparison link",
);
const search = readFileSync(resolve(output, "api/search"), "utf8");
const searchClient = staticClient({
  from: `data:application/json;base64,${Buffer.from(search).toString("base64")}`,
});
const results = await searchClient.search("await hydration replay callbacks");
assert(
  Array.isArray(results) &&
    results.some(({ url }) => {
      const route = url.split("#")[0];
      return route === `/${legacyPath}` || route === `${base}${legacyPath}`;
    }),
  "Static search must find published release notes by their content",
);
console.log(
  `Verified ${links.length} documentation links, LLM output, and static search`,
);
