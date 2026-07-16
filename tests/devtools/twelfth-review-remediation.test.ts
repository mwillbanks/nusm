import { describe, expect, test } from "bun:test";
import type { NusmAdapter, PersistSlice } from "../../src";
import { createNusmStore } from "../../src";

type State = { a: number; b: number };

const isolatedSlices = (): Array<PersistSlice<State>> => [
  {
    apply: (state, value) => ({ ...state, a: value as number }),
    key: "a",
    select: (state) => state.a,
  },
  {
    apply: (state, value) => ({ ...state, b: value as number }),
    key: "b",
    select: (state) => state.b,
  },
];

const createObservedAdapter = (
  resolveKey: NonNullable<NusmAdapter["resolveKey"]>,
) => {
  const reads: string[] = [];
  const removes: string[] = [];
  const resolutions: string[] = [];
  const values = new Map<string, unknown>();
  const writes: Array<{ key: string; value: unknown }> = [];
  const adapter: NusmAdapter = {
    getItem: (key) => {
      reads.push(key);
      return values.get(key) ?? null;
    },
    name: "collision-observer",
    pacer: false,
    removeItem: (key) => {
      removes.push(key);
      values.delete(key);
    },
    resolveKey: (params) => {
      resolutions.push(params.sliceKey ?? params.kind);
      return resolveKey(params);
    },
    setItem: (key, value) => {
      writes.push({ key, value });
      values.set(key, value);
    },
  };
  return { adapter, reads, removes, resolutions, values, writes };
};

describe("persistence identity validation", () => {
  test("rejects duplicate logical slice keys before resolving or accessing persistence", () => {
    const observed = createObservedAdapter(({ sliceKey }) => `key:${sliceKey}`);
    const duplicate = isolatedSlices()[0];

    expect(() =>
      createNusmStore(
        { a: 1, b: 2 },
        {
          adapter: observed.adapter,
          persist: {
            slices: [duplicate, { ...duplicate }],
            strategy: "slices",
          },
          storeId: "duplicate-logical-keys",
        },
      ),
    ).toThrow('Persist slice key "a" is configured more than once.');
    expect(observed.resolutions).toEqual([]);
    expect(observed.reads).toEqual([]);
    expect(observed.writes).toEqual([]);
    expect(observed.removes).toEqual([]);
  });

  test("rejects distinct slices that resolve to one physical key before adapter access", () => {
    const observed = createObservedAdapter(() => "shared");

    expect(() =>
      createNusmStore(
        { a: 1, b: 2 },
        {
          adapter: observed.adapter,
          persist: { slices: isolatedSlices(), strategy: "slices" },
          storeId: "duplicate-physical-keys",
        },
      ),
    ).toThrow(
      'Persistence units "a" and "b" resolve to the same adapter key "shared".',
    );
    expect(observed.resolutions).toEqual(["a", "b"]);
    expect(observed.reads).toEqual([]);
    expect(observed.writes).toEqual([]);
    expect(observed.removes).toEqual([]);
  });

  test("resolves each physical key once and reuses it across hydration and writes", async () => {
    let sequence = 0;
    const observed = createObservedAdapter(
      ({ sliceKey }) => `physical:${sliceKey}:${sequence++}`,
    );
    const store = createNusmStore(
      { a: 1, b: 2 },
      {
        adapter: observed.adapter,
        persist: { slices: isolatedSlices(), strategy: "slices" },
        storeId: "stable-physical-keys",
      },
    );

    await store.ready;
    await (async () => {
      store.setState({ a: 3, b: 4 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    })();

    expect(observed.resolutions).toEqual(["a", "b"]);
    expect(observed.reads).toEqual(["physical:a:0", "physical:b:1"]);
    expect(observed.writes.map(({ key }) => key)).toEqual([
      "physical:a:0",
      "physical:b:1",
      "physical:a:0",
      "physical:b:1",
    ]);
    expect(observed.values).toEqual(
      new Map<string, unknown>([
        ["physical:a:0", 3],
        ["physical:b:1", 4],
      ]),
    );
  });

  test("rejects invalid physical adapter keys before adapter access", () => {
    for (const [storeId, resolveKey] of [
      ["empty-physical-key", () => ""],
      ["non-string-physical-key", () => undefined as unknown as string],
    ] as const) {
      const observed = createObservedAdapter(resolveKey);
      expect(() =>
        createNusmStore(
          { a: 1, b: 2 },
          {
            adapter: observed.adapter,
            persist: { slices: isolatedSlices(), strategy: "slices" },
            storeId,
          },
        ),
      ).toThrow("Persistence adapter keys must be non-empty strings.");
      expect(observed.reads).toEqual([]);
      expect(observed.writes).toEqual([]);
      expect(observed.removes).toEqual([]);
    }
  });
  test("resolves an entire-store physical key once for every operation", async () => {
    let sequence = 0;
    const observed = createObservedAdapter(() => `entire:${sequence++}`);
    const store = createNusmStore(
      { a: 1, b: 2 },
      {
        adapter: observed.adapter,
        persist: { strategy: "entire" },
        storeId: "stable-entire-key",
      },
    );
    await store.ready;
    await (async () => {
      store.setState({ a: 3, b: 4 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    })();
    expect(observed.resolutions).toEqual(["entire"]);
    expect(observed.reads).toEqual(["entire:0"]);
    expect(observed.writes.map(({ key }) => key)).toEqual([
      "entire:0",
      "entire:0",
    ]);
    expect(observed.values.get("entire:0")).toEqual({ a: 3, b: 4 });
  });
});
