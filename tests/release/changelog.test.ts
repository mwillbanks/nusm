import { describe, expect, test } from "bun:test";
import {
  approveChangelogStamp,
  parseChangelog,
  releaseVersion,
  renderReleaseNotes,
  stampChangelog,
} from "../../scripts/release/changelog.ts";
import { publicationStatus } from "../../scripts/release/check-npm-publication.ts";

const draft =
  "# Changelog\r\n\r\n## NEXT_RELEASE\r\n\r\n- Authored note.\r\n\r\n";
const history =
  "# [1.2.0](https://example.com/compare) (2026-10-08)\r\n\r\n" +
  "### Fixes\r\n\r\n- Preserve old notes.\r\n\r\n" +
  "## 1.1.1 (2026-08-03)\r\n\r\n- Old note.\r\n";
const source = draft + history;

describe("authored releases", () => {
  test("changes only the placeholder bytes in the real changelog", async () => {
    const actual = await Bun.file(
      new URL("../../CHANGELOG.md", import.meta.url),
    ).text();
    const historical = actual.slice(actual.indexOf("# [1.2.0]"));
    const expectedVersions = ["1.2.0", "1.1.1", "1.1.0", "0.1.0"];
    const released = parseChangelog(actual);
    expect(released.map(({ version }) => version).slice(-4)).toEqual(
      expectedVersions,
    );
    const pending = draft + historical;
    expect(stampChangelog(pending, "2.0.0")).toBe(
      draft.replace("NEXT_RELEASE", "2.0.0") + historical,
    );
  });

  test("preserves line endings, notes, and historical headings", () => {
    const stamped = stampChangelog(source, "1.3.0");
    expect(stamped).toBe(source.replace("NEXT_RELEASE", "1.3.0"));
    expect(parseChangelog(stamped)).toEqual([
      {
        version: "1.3.0",
        heading: "1.3.0",
        body: "\r\n- Authored note.\r\n\r\n",
      },
      {
        version: "1.2.0",
        heading: "[1.2.0](https://example.com/compare) (2026-10-08)",
        body: "\r\n### Fixes\r\n\r\n- Preserve old notes.\r\n\r\n",
      },
      {
        version: "1.1.1",
        heading: "1.1.1 (2026-08-03)",
        body: "\r\n- Old note.\r\n",
      },
    ]);
  });

  test("ignores headings inside fenced code and excludes the pending section", () => {
    const pending =
      draft + "~~~md\n## NEXT_RELEASE\n# 9.9.9\n~~~~\n\n" + history;
    expect(parseChangelog(pending).map(({ version }) => version)).toEqual([
      "1.2.0",
      "1.1.1",
    ]);
    expect(stampChangelog(pending, "1.3.0")).toBe(
      pending.replace("NEXT_RELEASE", "1.3.0"),
    );
  });

  test("supports reruns and a changed proposed version", () => {
    const prior = stampChangelog(source, "1.2.1");
    expect(approveChangelogStamp(source, prior, "1.2.1")).toBe(prior);
    expect(approveChangelogStamp(source, prior, "1.3.0")).toBe(
      stampChangelog(source, "1.3.0"),
    );
    expect(() =>
      approveChangelogStamp(
        source,
        prior.replace("Authored", "Edited"),
        "1.3.0",
      ),
    ).toThrow("differs from");
  });

  test("reports missing, duplicate, empty, non-stable, and non-increasing proposals", () => {
    expect(() => stampChangelog(history, "1.3.0")).toThrow("exactly one");
    expect(() => stampChangelog(source + draft, "1.3.0")).toThrow(
      "exactly one",
    );
    expect(() =>
      stampChangelog("## NEXT_RELEASE\n\n" + history, "1.3.0"),
    ).toThrow("Add authored notes");
    expect(() => stampChangelog(source, "1.3.0-rc.1")).toThrow(
      "stable nusm version",
    );
    expect(() => stampChangelog(source, "1.2.0")).toThrow("must follow");
  });

  test("requires matching package and manifest versions", () => {
    const manifest = JSON.stringify({ ".": "1.3.0" });
    expect(releaseVersion(manifest, '{"name":"nusm","version":"1.3.0"}')).toBe(
      "1.3.0",
    );
    expect(() =>
      releaseVersion(manifest, '{"name":"nusm","version":"1.2.0"}'),
    ).toThrow("must agree");
    expect(() =>
      releaseVersion(manifest, '{"name":"another-package","version":"1.3.0"}'),
    ).toThrow("must agree");
  });

  test("extracts GitHub notes from the same stamped section used by the docs", () => {
    const stamped = stampChangelog(source, "1.3.0");
    const notes = renderReleaseNotes(stamped, "1.3.0");
    expect(notes).toStartWith(parseChangelog(stamped)[0]!.body);
    expect(notes).toContain(
      "https://mwillbanks.github.io/nusm/docs/releases/1.3.0",
    );
    expect(notes).not.toContain("Old note");
    expect(() => renderReleaseNotes(source, "1.2.0")).toThrow(
      "latest changelog",
    );
    expect(() => renderReleaseNotes(stamped, "1.2.0")).toThrow(
      "latest changelog",
    );
  });

  test("requires matching published tarball integrity", () => {
    expect(publicationStatus("sha512-matching", "sha512-matching")).toBe(
      "already-published",
    );
    expect(() => publicationStatus("sha512-other", "sha512-expected")).toThrow(
      "integrity differs",
    );
  });
});
