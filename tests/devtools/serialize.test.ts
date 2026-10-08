import { describe, expect, test } from "bun:test";
import {
  isRoundTrippableForDevtools,
  stringifyForDevtools,
} from "../../src/devtools/serialize";

describe("devtools serialization", () => {
  test("accepts the complete JSON data domain", () => {
    expect(
      isRoundTrippableForDevtools({
        array: [null, true, 1, "state"],
        nested: { ok: false },
      }),
    ).toBe(true);
    expect(
      isRoundTrippableForDevtools(
        Object.assign(Object.create(null), { safe: "value" }),
      ),
    ).toBe(true);
  });

  test("rejects lossy, executable, accessor, circular, and exotic values", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => 1,
    });
    const symbolRecord = { [Symbol("state")]: true };
    for (const value of [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1n,
      () => undefined,
      new Date(),
      circular,
      accessor,
      symbolRecord,
    ]) {
      expect(isRoundTrippableForDevtools(value)).toBe(false);
    }
    const throwingPrototype = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("prototype denied");
        },
      },
    );
    expect(isRoundTrippableForDevtools(throwingPrototype)).toBe(false);
    const nonErrorPrototype = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw "prototype denied";
        },
      },
    );
    expect(isRoundTrippableForDevtools(nonErrorPrototype)).toBe(false);
    const sparse: unknown[] = [];
    sparse.length = 2;
    expect(isRoundTrippableForDevtools(sparse)).toBe(false);
  });

  test("formats bigint, circular, undefined, and throwing proxies safely", () => {
    const circular: { value: bigint; self?: unknown } = { value: 2n };
    circular.self = circular;
    expect(stringifyForDevtools(circular)).toContain('"2n"');
    expect(stringifyForDevtools(circular)).toContain("[Circular");
    expect(stringifyForDevtools(undefined)).toBe("undefined");
    const throwing = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("no inspection");
        },
      },
    );
    expect(stringifyForDevtools(throwing)).toContain(
      "Uninspectable: no inspection",
    );
    const nonError = new Proxy(
      {},
      {
        ownKeys: () => {
          throw "no inspection";
        },
      },
    );
    expect(stringifyForDevtools(nonError)).toContain(
      "Uninspectable: no inspection",
    );
    const descriptorDenied = new Proxy(
      { value: 1 },
      {
        getOwnPropertyDescriptor: () => {
          throw new Error("descriptor denied");
        },
      },
    );
    expect(stringifyForDevtools(descriptorDenied)).toContain(
      "Uninspectable: descriptor denied",
    );
    const stringify = JSON.stringify;
    JSON.stringify = (() => {
      throw new Error("serializer denied");
    }) as typeof JSON.stringify;
    try {
      expect(stringifyForDevtools({ value: 1 })).toBe(
        "[Unserializable: serializer denied]",
      );
    } finally {
      JSON.stringify = stringify;
    }
  });
});
