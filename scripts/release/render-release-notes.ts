import { releaseVersion, renderReleaseNotes } from "./changelog.ts";

const [manifest, pkg, changelog] = await Promise.all(
  [".release-please-manifest.json", "package.json", "CHANGELOG.md"].map(
    (path) => Bun.file(path).text(),
  ),
);
if (manifest === undefined || pkg === undefined || changelog === undefined) {
  throw new Error("Missing release input");
}

const version = releaseVersion(manifest, pkg);
const [expected, ...extra] = Bun.argv.slice(2);
if (extra.length || (expected !== undefined && expected !== version)) {
  throw new Error(`Expected release tag ${version}`);
}
process.stdout.write(renderReleaseNotes(changelog, version));
