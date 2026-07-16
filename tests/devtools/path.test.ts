import { describe, expect, test } from "bun:test";
import {
  flattenValue,
  formatPath,
  parsePath,
} from "../../src/devtools/panel-model";
import {
  getValueAtPath,
  removeValueAtPath,
  setValueAtPath,
} from "../../src/devtools/path";

describe("devtools path operations", () => {
  test("immutably adds, edits, and removes nested object and array values", () => {
    const original = { profile: { name: "Ada" }, tasks: [{ done: false }] };
    const renamed = setValueAtPath(original, ["profile", "name"], "Grace");
    const appended = setValueAtPath(renamed, ["tasks", 1], { done: true });
    const removed = removeValueAtPath(appended, ["tasks", 0]);

    expect(original.profile.name).toBe("Ada");
    expect(getValueAtPath(renamed, ["profile", "name"])).toBe("Grace");
    expect(getValueAtPath(removed, ["tasks", 0])).toEqual({ done: true });
  });

  test("rejects prototype pollution and invalid array gaps", () => {
    expect(() => setValueAtPath({}, ["__proto__", "polluted"], true)).toThrow(
      "Unsafe",
    );
    expect(() => setValueAtPath([], [2], "gap")).toThrow("outside");
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  test("parses and flattens searchable paths", () => {
    expect(parsePath("$.users[0].name")).toEqual(["users", 0, "name"]);
    const rows = flattenValue({ users: [{ name: "Ada" }] }, "ada");
    expect(rows.map((row) => formatPath(row.path))).toEqual([
      `$["users"][0]["name"]`,
    ]);
  });
});
