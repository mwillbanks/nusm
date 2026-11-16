const pendingVersion = "NEXT_RELEASE";
const stableVersion = "(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)";
const versionPattern = new RegExp(`^${stableVersion}$`);
const versionHeading = new RegExp(
  `^(?:\\[(${stableVersion})\\](?=\\()|(${stableVersion})(?=[ \\t]|$))`,
);

type ReleaseSection = {
  version: string;
  heading: string;
  body: string;
};

type SectionStart = Omit<ReleaseSection, "body"> & {
  level: number;
  start: number;
  bodyStart: number;
};

export function validateReleaseVersion(value: unknown): string {
  if (typeof value !== "string" || !versionPattern.test(value)) {
    throw new Error("Expected a stable nusm version such as 1.2.1");
  }
  return value;
}

function sectionStarts(source: string): SectionStart[] {
  const sections: SectionStart[] = [];
  let fence: string | undefined;
  for (const line of source.matchAll(/[^\r\n]*(?:\r\n|\n|$)/g)) {
    const raw = line[0];
    const text = raw.replace(/\r?\n$/, "");
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
    if (fence) {
      if (
        delimiter &&
        delimiter[1]?.startsWith(fence) &&
        delimiter[2]?.trim() === ""
      ) {
        fence = undefined;
      }
      continue;
    }
    if (delimiter?.[1]) {
      fence = delimiter[1];
      continue;
    }
    const heading = /^(#{1,2})[ \t]+(.+?)[ \t]*$/.exec(text);
    if (!heading?.[1] || !heading[2]) continue;
    const title = heading[2];
    const match = versionHeading.exec(title);
    const version =
      title === pendingVersion ? pendingVersion : (match?.[1] ?? match?.[2]);
    if (!version) continue;

    sections.push({
      version,
      heading: title,
      level: heading[1].length,
      start: line.index,
      bodyStart: line.index + raw.length,
    });
  }
  return sections;
}

export function parseChangelog(source: string): ReleaseSection[] {
  const starts = sectionStarts(source);
  const versions = new Set<string>();
  return starts.flatMap(({ version, heading, bodyStart }, index) => {
    if (version === pendingVersion) {
      if (index !== 0 || starts[index]?.level !== 2) {
        throw new Error("NEXT_RELEASE must be the first release heading");
      }
      return [];
    }
    if (versions.has(version)) {
      throw new Error(`Duplicate changelog version ${version}`);
    }
    versions.add(version);
    return [
      {
        version,
        heading,
        body: source.slice(bodyStart, starts[index + 1]?.start),
      },
    ];
  });
}

export function stampChangelog(
  source: string,
  proposedVersion: string,
): string {
  const version = validateReleaseVersion(proposedVersion);
  const [first, ...history] = sectionStarts(source);
  if (
    first?.version !== pendingVersion ||
    first.level !== 2 ||
    history.some((entry) => entry.version === pendingVersion)
  ) {
    throw new Error("Expected exactly one top-level ## NEXT_RELEASE section");
  }
  if (!source.slice(first.bodyStart, history[0]?.start).trim()) {
    throw new Error("Add authored notes to the NEXT_RELEASE section");
  }
  const previous = parseChangelog(source)[0]?.version;
  if (previous && Bun.semver.order(version, previous) <= 0) {
    throw new Error(`Release version ${version} must follow ${previous}`);
  }

  const position = source.indexOf(pendingVersion, first.start);
  return (
    source.slice(0, position) +
    version +
    source.slice(position + pendingVersion.length)
  );
}

export function approveChangelogStamp(
  base: string,
  candidate: string,
  proposedVersion: string,
): string {
  const stamped = stampChangelog(base, proposedVersion);
  if (candidate === base || candidate === stamped) return stamped;

  const priorProposal = parseChangelog(candidate)[0]?.version;
  const lastRelease = parseChangelog(base)[0]?.version;
  if (
    priorProposal &&
    (!lastRelease || Bun.semver.order(priorProposal, lastRelease) > 0) &&
    candidate === stampChangelog(base, priorProposal)
  ) {
    return stamped;
  }
  throw new Error(
    "Release PR changelog differs from the authored main changelog",
  );
}

export function releaseVersion(manifest: string, packageJson: string): string {
  const version = validateReleaseVersion(JSON.parse(manifest)?.["."]);
  const pkg = JSON.parse(packageJson);
  if (pkg?.name !== "nusm" || pkg.version !== version) {
    throw new Error("nusm package.json and the release manifest must agree");
  }
  return version;
}

export function renderReleaseNotes(
  source: string,
  expectedVersion: string,
): string {
  const version = validateReleaseVersion(expectedVersion);
  const release = parseChangelog(source)[0];
  if (
    sectionStarts(source)[0]?.version !== version ||
    release?.version !== version ||
    !release.body.trim()
  ) {
    throw new Error(`Expected the latest changelog section to be ${version}`);
  }
  return (
    release.body +
    `\n\n[Read the release notes on the documentation site](https://mwillbanks.github.io/nusm/docs/releases/${version}).\n`
  );
}
