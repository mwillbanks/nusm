import { describe, expect, test } from "bun:test";
import type { NusmAdapter, PersistSlice } from "../../src";
import { createNusmStore } from "../../src";

describe("eleventh semantic review remediation", () => {
  test("rejects a missing slice that invalidates an already hydrated sibling", async () => {
    type State = { a: number; b: number };
    const values = new Map<string, unknown>([
      ["nusm:cross-slice-isolation:slice:a", 1],
    ]);
    const writes: string[] = [];
    const adapter: NusmAdapter = {
      getItem: (key) => values.get(key) ?? null,
      name: "cross-slice-isolation",
      pacer: false,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => {
        writes.push(key);
        values.set(key, value);
      },
    };
    const slices: Array<PersistSlice<State>> = [
      {
        apply: (state, value) => ({ ...state, a: value as number }),
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
        storeId: "cross-slice-isolation",
      },
    );

    await expect(store.ready).rejects.toThrow(
      'Persist slice "a" is not isolated',
    );
    expect(writes).toEqual([]);
    expect(values.has("nusm:cross-slice-isolation:slice:b")).toBeFalse();
    expect(store.hydration.overall).toBe("error");
  });
});
