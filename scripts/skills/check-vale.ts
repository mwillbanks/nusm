import { deepStrictEqual, equal, ok } from "node:assert/strict";

type Alert = { Check: string };

function check(file: string): { exitCode: number; checks: string[] } {
  const result = Bun.spawnSync([
    "vale",
    "--no-global",
    "--output=JSON",
    `scripts/skills/vale-fixtures/${file}`,
  ]);
  const output = result.stdout.toString();
  ok(output, result.stderr.toString() || "Vale returned no fixture report.");
  const report: Record<string, Alert[]> = JSON.parse(output);
  const checks = (report[`scripts/skills/vale-fixtures/${file}`] ?? [])
    .map((alert) => alert.Check)
    .sort();
  return { exitCode: result.exitCode, checks };
}

const passing = check("pass.md");
equal(passing.exitCode, 0);
deepStrictEqual(passing.checks, []);

const failing = check("fail.md");
equal(failing.exitCode, 1, "Vale must reject the overlong fixtures.");
deepStrictEqual(failing.checks, [
  "NusmSTE.DescriptiveLength",
  "NusmSTE.ProcedureLength",
]);
