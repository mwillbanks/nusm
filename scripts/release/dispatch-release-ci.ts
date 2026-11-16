import { approveChangelogStamp, releaseVersion } from "./changelog.ts";

const releaseBranch = "release-please--branches--main--components--nusm";
const maxAttempts = 4;
const maxReleaseFileBytes = 1024 * 1024;
const changelogFile = "CHANGELOG.md";

type ReleasePullRequest = {
  state: string;
  base: { ref: string; sha: string; repo: { full_name: string } };
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  labels: { name: string }[];
};

export type ReleaseCiApi = {
  pullRequest(number: number): Promise<ReleasePullRequest>;
  readFile(path: string, sha: string): Promise<string>;
  stamp(ref: string, expectedSha: string, changelog: string): Promise<string>;
  dispatch(ref: string, expectedSha: string): Promise<void>;
};

function sha(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error("Expected a GitHub commit SHA");
  }
  return value;
}

function verifyPullRequest(
  pr: ReleasePullRequest,
  repository: string,
  number: number,
) {
  if (
    pr.state !== "open" ||
    pr.base.ref !== "main" ||
    pr.base.repo.full_name !== repository ||
    pr.head.repo?.full_name !== repository ||
    pr.head.ref !== releaseBranch ||
    !pr.labels.some((label) => label.name === "autorelease: pending")
  ) {
    throw new Error(`Refusing to stamp unexpected release PR ${number}`);
  }
  sha(pr.head.sha);
  sha(pr.base.sha);
}

export async function dispatchReleaseCi(
  repository: string,
  number: number,
  api: ReleaseCiApi,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const pr = await api.pullRequest(number);
    verifyPullRequest(pr, repository, number);
    const [manifest, pkg, base, candidate] = await Promise.all([
      api.readFile(".release-please-manifest.json", pr.head.sha),
      api.readFile("package.json", pr.head.sha),
      api.readFile(changelogFile, pr.base.sha),
      api.readFile(changelogFile, pr.head.sha),
    ]);
    const current = await api.pullRequest(number);
    verifyPullRequest(current, repository, number);
    if (current.head.sha !== pr.head.sha || current.base.sha !== pr.base.sha) {
      continue;
    }

    const version = releaseVersion(manifest, pkg);
    const stamped = approveChangelogStamp(base, candidate, version);
    let expectedHead = pr.head.sha;
    if (candidate !== stamped) {
      try {
        expectedHead = sha(
          await api.stamp(releaseBranch, pr.head.sha, stamped),
        );
      } catch (error) {
        const latest = await api.pullRequest(number);
        verifyPullRequest(latest, repository, number);
        if (
          latest.head.sha === expectedHead &&
          latest.base.sha === pr.base.sha
        ) {
          throw error;
        }
        continue;
      }
    }

    await api.dispatch(releaseBranch, expectedHead);
    return expectedHead;
  }
  throw new Error("Release PR kept changing. Retry after its head settles.");
}

function fileContent(value: unknown, path: string): string {
  const file = value as {
    type?: unknown;
    path?: unknown;
    size?: unknown;
    encoding?: unknown;
    content?: unknown;
  } | null;
  if (
    file?.type !== "file" ||
    file.path !== path ||
    typeof file.size !== "number" ||
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    file.size > maxReleaseFileBytes ||
    file.encoding !== "base64" ||
    typeof file.content !== "string"
  ) {
    throw new Error(`Invalid release input ${path}`);
  }
  const encoded = file.content.replaceAll("\n", "");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== file.size || bytes.toString("base64") !== encoded) {
    throw new Error(`Invalid release input encoding for ${path}`);
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    bytes,
  );
}

async function runReleaseCi() {
  const { GITHUB_REPOSITORY: repository, GH_TOKEN: token } = process.env;
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !token) {
    throw new Error("Set GITHUB_REPOSITORY and GH_TOKEN");
  }

  const prs: unknown = JSON.parse(process.env.RELEASE_PRS ?? "[]");
  if (!Array.isArray(prs) || prs.length !== 1) {
    throw new Error("Expected exactly one nusm release PR from Release Please");
  }
  const prNumber: unknown = prs[0]?.number;
  if (
    typeof prNumber !== "number" ||
    !Number.isSafeInteger(prNumber) ||
    prNumber <= 0
  ) {
    throw new Error("Expected a valid release PR number");
  }
  const origin = process.env.GITHUB_API_URL ?? "https://api.github.com";

  async function request(url: string, body?: unknown): Promise<Response> {
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(
        `GitHub release request failed with HTTP ${response.status}`,
      );
    }
    return response;
  }

  function rest(path: string, body?: unknown): Promise<Response> {
    return request(`${origin}/repos/${repository}/${path}`, body);
  }

  const expectedHead = await dispatchReleaseCi(repository, prNumber, {
    async pullRequest(number) {
      return (
        await rest(`pulls/${number}`)
      ).json() as Promise<ReleasePullRequest>;
    },
    async readFile(path, commit) {
      const input = await rest(
        `contents/${encodeURIComponent(path)}?ref=${sha(commit)}`,
      );
      return fileContent(await input.json(), path);
    },
    async stamp(ref, expectedSha, changelog) {
      const response = await request(
        process.env.GITHUB_GRAPHQL_URL ?? `${origin}/graphql`,
        {
          query: `mutation($input: CreateCommitOnBranchInput!) {
            createCommitOnBranch(input: $input) { commit { oid } }
          }`,
          variables: {
            input: {
              branch: { repositoryNameWithOwner: repository, branchName: ref },
              expectedHeadOid: expectedSha,
              message: { headline: "docs: stamp nusm release changelog" },
              fileChanges: {
                additions: [
                  {
                    path: changelogFile,
                    contents: Buffer.from(changelog).toString("base64"),
                  },
                ],
              },
            },
          },
        },
      );
      const body = (await response.json()) as {
        errors?: { message?: string }[];
        data?: { createCommitOnBranch?: { commit?: { oid?: string } } };
      };
      if (body.errors?.length) {
        throw new Error(
          body.errors[0]?.message ?? "GitHub rejected the release commit",
        );
      }
      return sha(body.data?.createCommitOnBranch?.commit?.oid);
    },
    async dispatch(ref, expectedSha) {
      await rest("actions/workflows/ci.yml/dispatches", {
        ref,
        inputs: { expected_sha: expectedSha },
      });
    },
  });
  console.log(`Requested release CI for ${expectedHead}`);
}

if (import.meta.main) await runReleaseCi();
