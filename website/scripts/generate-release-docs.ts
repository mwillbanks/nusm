import { mkdir, readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { parseChangelog } from "../../scripts/release/changelog.js";

const releaseDirectory = resolve(
  import.meta.dirname,
  "../content/docs/releases",
);
const changelogPath = resolve(import.meta.dirname, "../../CHANGELOG.md");
const releaseRoute = "/docs/releases";

export function renderReleaseDocs(source: string): Map<string, string> {
  const releases = parseChangelog(source);
  const files = new Map<string, string>();
  const index = releases.map(
    ({ version }) => `- [${version}](${releaseRoute}/${version})`,
  );

  files.set(
    "index.md",
    "---\ntitle: Release Notes\ndescription: Changes in each published version of nusm.\n---\n\n" +
      index.join("\n") +
      "\n",
  );
  files.set(
    "meta.json",
    JSON.stringify(
      {
        title: "Release Notes",
        pages: ["index", ...releases.map(({ version }) => version)],
      },
      null,
      2,
    ) + "\n",
  );

  for (const { version, heading, body } of releases) {
    files.set(
      `${version}.md`,
      `---\ntitle: ${JSON.stringify(`nusm ${version}`)}\n---\n\n## ${heading}\n${body}`,
    );
  }
  return files;
}

async function generateReleaseDocs(): Promise<void> {
  const files = renderReleaseDocs(await Bun.file(changelogPath).text());
  await mkdir(releaseDirectory, { recursive: true });
  for (const name of await readdir(releaseDirectory)) {
    if (/^\d+\.\d+\.\d+\.md$/.test(name) && !files.has(name)) {
      await unlink(resolve(releaseDirectory, name));
    }
  }
  for (const [name, content] of files) {
    const file = Bun.file(resolve(releaseDirectory, name));
    if (!(await file.exists()) || (await file.text()) !== content) {
      await Bun.write(file, content);
    }
  }
}

if (import.meta.main) await generateReleaseDocs();
