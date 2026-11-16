import { validateReleaseVersion } from "./changelog.ts";

export function publicationStatus(
  installedIntegrity: unknown,
  expectedIntegrity: string,
): "already-published" {
  if (installedIntegrity !== expectedIntegrity) {
    throw new Error(
      "Published nusm tarball integrity differs from the release artifact",
    );
  }
  return "already-published";
}

if (import.meta.main) {
  const [tag, archive, ...extra] = Bun.argv.slice(2);
  const version = validateReleaseVersion(tag);
  if (!archive || extra.length) {
    throw new Error("Usage: check-npm-publication <release-version> <tarball>");
  }
  const hash = new Bun.CryptoHasher("sha512");
  hash.update(await Bun.file(archive).arrayBuffer());
  const expectedIntegrity = `sha512-${hash.digest("base64")}`;
  const response = await fetch(`https://registry.npmjs.org/nusm/${version}`, {
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) {
    console.log("pending");
  } else {
    if (!response.ok) {
      throw new Error(
        `npm registry request failed with HTTP ${response.status}`,
      );
    }
    const published = (await response.json()) as {
      dist?: { integrity?: unknown };
    };
    console.log(
      publicationStatus(published.dist?.integrity, expectedIntegrity),
    );
  }
}
