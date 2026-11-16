import { expect, test } from "bun:test";
import {
  dispatchReleaseCi,
  type ReleaseCiApi,
} from "../../scripts/release/dispatch-release-ci.ts";

const repository = "mwillbanks/nusm";
const branch = "release-please--branches--main--components--nusm";
const base = "a".repeat(40);
const candidate = "b".repeat(40);
const stamped = "c".repeat(40);
const updated = "d".repeat(40);
const changelog = "# Changelog\n\n## NEXT_RELEASE\n\n- Authored note.\n";
const stampedChangelog = changelog.replace("NEXT_RELEASE", "1.3.0");

function fixture() {
  const pr = {
    state: "open",
    base: { ref: "main", sha: base, repo: { full_name: repository } },
    head: { ref: branch, sha: candidate, repo: { full_name: repository } },
    labels: [{ name: "autorelease: pending" }],
  };
  const calls: [string, string, string][] = [];
  const api: ReleaseCiApi = {
    async pullRequest() {
      return structuredClone(pr);
    },
    async readFile(path, commit) {
      if (path === ".release-please-manifest.json") return '{".":"1.3.0"}';
      if (path === "package.json") return '{"name":"nusm","version":"1.3.0"}';
      return commit === stamped ? stampedChangelog : changelog;
    },
    async stamp(ref, expectedSha, contents) {
      calls.push(["stamp", ref, expectedSha]);
      expect(contents).toBe(stampedChangelog);
      pr.head.sha = stamped;
      return stamped;
    },
    async dispatch(ref, expectedSha) {
      calls.push(["dispatch", ref, expectedSha]);
    },
  };
  return { pr, calls, api };
}

test("stamps a release PR and dispatches CI on the new head", async () => {
  const { api, calls } = fixture();
  expect(await dispatchReleaseCi(repository, 1, api)).toBe(stamped);
  expect(calls).toEqual([
    ["stamp", branch, candidate],
    ["dispatch", branch, stamped],
  ]);
});

test("dispatches on an already stamped head without another commit", async () => {
  const { api, calls, pr } = fixture();
  pr.head.sha = stamped;
  expect(await dispatchReleaseCi(repository, 1, api)).toBe(stamped);
  expect(calls).toEqual([["dispatch", branch, stamped]]);
});

test("recomputes after the PR head changes during the reads", async () => {
  const { api, calls, pr } = fixture();
  const read = api.readFile;
  api.readFile = async (path, commit) => {
    if (commit === candidate) pr.head.sha = updated;
    return read(path, commit);
  };
  expect(await dispatchReleaseCi(repository, 1, api)).toBe(stamped);
  expect(calls).toEqual([
    ["stamp", branch, updated],
    ["dispatch", branch, stamped],
  ]);
});

test("recomputes after the compare-and-set stamp loses a race", async () => {
  const { api, calls, pr } = fixture();
  const stamp = api.stamp;
  api.stamp = async (ref, expectedSha, contents) => {
    if (expectedSha === candidate) {
      pr.head.sha = updated;
      throw new Error("stale SHA");
    }
    return stamp(ref, expectedSha, contents);
  };
  expect(await dispatchReleaseCi(repository, 1, api)).toBe(stamped);
  expect(calls).toEqual([
    ["stamp", branch, updated],
    ["dispatch", branch, stamped],
  ]);
});

test("refuses an unrelated or forked PR before any write", async () => {
  const { api, calls, pr } = fixture();
  pr.head.repo.full_name = "fork/nusm";
  await expect(dispatchReleaseCi(repository, 1, api)).rejects.toThrow(
    "unexpected release PR",
  );
  expect(calls).toEqual([]);
});

test("does not dispatch if the commit fails and the head is current", async () => {
  const { api, calls } = fixture();
  api.stamp = async () => {
    throw new Error("permission denied");
  };
  await expect(dispatchReleaseCi(repository, 1, api)).rejects.toThrow(
    "permission denied",
  );
  expect(calls).toEqual([]);
});
