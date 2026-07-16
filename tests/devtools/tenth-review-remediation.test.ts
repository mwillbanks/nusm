import { describe, expect, test } from "bun:test";
import type { NusmAdapter, PersistSlice } from "../../src";
import { createNusmStore } from "../../src";

describe("tenth semantic review remediation", () => {
  test("rejects mutually interacting missing slices before persisting a false baseline", async () => {
    type State = { a: number; b: number };
    const writes: Array<{ key: string; value: unknown }> = [];
    const adapter: NusmAdapter = {
      getItem: () => null,
      name: "isolated-slice-contract",
      pacer: false,
      removeItem: () => undefined,
      setItem: (key, value) => {
        writes.push({ key, value });
      },
    };
    const slices: Array<PersistSlice<State>> = [
      {
        apply: (state, value) => ({ ...state, a: value as number, b: 99 }),
        key: "a",
        select: (state) => state.a,
      },
      {
        apply: (state, value) => ({ ...state, a: 88, b: value as number }),
        key: "b",
        select: (state) => state.b,
      },
    ];
    const store = createNusmStore(
      { a: 1, b: 2 },
      {
        adapter,
        persist: { slices, strategy: "slices" },
        storeId: "mutually-interacting-slices",
      },
    );

    await expect(store.ready).rejects.toThrow(
      'Persist slice "a" is not isolated',
    );
    expect(store.state).toBeUndefined();
    expect(store.hydration.overall).toBe("error");
    expect(store.isReady).toBeFalse();
    expect(writes).toEqual([]);
  });
});
