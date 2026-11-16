import { expect, test } from "bun:test";
import { renderReleaseDocs } from "./generate-release-docs";

test("renders authored release pages and hides the pending section", () => {
  const files = renderReleaseDocs(`# Changelog

## NEXT_RELEASE

- Pending change.

# [1.2.0](https://example.com/compare) (2026-10-08)

### Changed

- Published change.

## 1.1.1

- Historical change.
`);

  expect([...files.keys()]).toEqual([
    "index.md",
    "meta.json",
    "1.2.0.md",
    "1.1.1.md",
  ]);
  expect(JSON.parse(files.get("meta.json")!)).toEqual({
    title: "Release Notes",
    pages: ["index", "1.2.0", "1.1.1"],
  });
  expect(files.get("index.md")).toContain("- [1.2.0](/docs/releases/1.2.0)");
  expect(files.get("1.2.0.md")).toBe(
    '---\ntitle: "nusm 1.2.0"\n---\n\n' +
      "## [1.2.0](https://example.com/compare) (2026-10-08)\n\n" +
      "### Changed\n\n- Published change.\n\n",
  );
  expect(files.get("1.1.1.md")).toContain("- Historical change.");
  expect([...files.values()].join("\n")).not.toContain("Pending change.");
});
