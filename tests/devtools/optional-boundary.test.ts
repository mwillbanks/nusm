import { expect, test } from "bun:test";

const rootEntry = await Bun.file(
  new URL("../../src/index.ts", import.meta.url),
).text();
const metadata = await Bun.file(
  new URL("../../package.json", import.meta.url),
).json();

test("keeps the root entry isolated and devtools framework dependencies optional", () => {
  expect(rootEntry).not.toContain("./devtools");
  for (const dependency of [
    "@tanstack/devtools",
    "@tanstack/devtools-utils",
    "lucide-react",
    "react",
    "react-dom",
  ]) {
    expect(metadata.peerDependenciesMeta[dependency].optional).toBe(true);
  }
});
