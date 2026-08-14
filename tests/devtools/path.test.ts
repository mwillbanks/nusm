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

  test("rejects unsafe numeric path segments", () => {
    expect(() => getValueAtPath([], [-1])).toThrow("non-negative");
    expect(() => getValueAtPath([], [Number.MAX_SAFE_INTEGER + 1])).toThrow(
      "non-negative",
    );
  });

  test("parses and flattens searchable paths", () => {
    expect(parsePath("$.users[0].name")).toEqual(["users", 0, "name"]);
    const rows = flattenValue({ users: [{ name: "Ada" }] }, "ada");
    expect(rows.map((row) => formatPath(row.path))).toEqual([
      `$["users"][0]["name"]`,
    ]);
  });

  test("reports inspection limits and descriptor failures", () => {
    const deep = { child: { value: 1 } };
    const depthRows = flattenValue(deep, "", [], { maxDepth: 1 });
    expect(depthRows.some((row) => row.truncated === "depth")).toBe(true);

    const nodeRows = flattenValue({ child: { value: 1 } }, "", [], {
      maxNodes: 1,
    });
    expect(nodeRows.some((row) => row.truncated === "nodes")).toBe(true);

    const throwing = new Proxy(
      { value: 1 },
      {
        getOwnPropertyDescriptor: () => {
          throw new Error("descriptor denied");
        },
      },
    );
    const rows = flattenValue(throwing);
    expect(rows[0]?.preview).toContain("Uninspectable: descriptor denied");
  });

  test("rejects symbol and accessor properties during immutable edits", () => {
    const symbol = Symbol("state");
    const symbolic = { [symbol]: 1 };
    expect(() => setValueAtPath(symbolic, ["value"], 2)).toThrow(
      "Symbol properties",
    );
    const accessor = {};
    Object.defineProperty(accessor, "value", {
      enumerable: true,
      get: () => 1,
    });
    expect(() => setValueAtPath(accessor, ["other"], 2)).toThrow(
      "Accessor properties",
    );
    const nonErrorProxy = new Proxy(
      { value: 1 },
      {
        getOwnPropertyDescriptor: () => {
          throw "descriptor denied";
        },
      },
    );
    expect(() => setValueAtPath(nonErrorProxy, ["value"], 2)).toThrow(
      "descriptor denied",
    );
  });

  test("creates a container when editing a primitive root", () => {
    expect(setValueAtPath(1, ["value"], 2)).toEqual({ value: 2 });
  });
});
