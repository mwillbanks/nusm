import { describe, expect, test } from "bun:test";
import type { NusmAdapter, PersistSlice } from "../../src";
import { createNusmStore } from "../../src";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const relay = () => {
  const target = new EventTarget();
  target.addEventListener("tanstack-connect", () =>
    target.dispatchEvent(new CustomEvent("tanstack-connect-success")),
  );
  target.addEventListener("tanstack-dispatch-event", (event) => {
    const detail = (event as CustomEvent<{ type: string; payload: unknown }>)
      .detail;
    target.dispatchEvent(new CustomEvent(detail.type, { detail }));
  });
  return target;
};

describe("devtools mutation validation", () => {
  test("rejects lossy memory values and persisted writes without adapters", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const results: Array<{
      commandId: string;
      error?: string;
      status: string;
    }> = [];
    target.addEventListener("nusm:commandResult", (event) =>
      results.push((event as CustomEvent).detail.payload),
    );
    const store = createNusmStore(
      { profile: { name: "Ada" } },
      { devtools: true, storeId: "validation" },
    );
    await store.ready;
    const command = (payload: Record<string, unknown>) =>
      target.dispatchEvent(
        new CustomEvent("nusm:command", { detail: { payload } }),
      );
    command({
      action: "set_path",
      commandId: "lossy",
      instanceId: store.devtoolsInstanceId,
      location: "memory",
      path: ["profile", "name"],
      storeId: "validation",
      value: undefined,
    });
    command({
      action: "replace_persisted",
      commandId: "no-adapter",
      instanceId: store.devtoolsInstanceId,
      storeId: "validation",
      value: {},
    });
    await tick();
    expect(store.state.profile.name).toBe("Ada");
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ commandId: "lossy", status: "error" }),
        expect.objectContaining({ commandId: "no-adapter", status: "error" }),
      ]),
    );
    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
  });

  test("validates and writes exact slice persistence shapes", async () => {
    type State = { prefs: { theme: string } };
    const data = new Map<string, unknown>();
    const adapter: NusmAdapter = {
      getItem: (key) => data.get(key) ?? null,
      name: "slices",
      pacer: false,
      removeItem: (key) => data.delete(key),
      setItem: (key, value) => data.set(key, value),
    };
    const slices: Array<PersistSlice<State>> = [
      {
        apply: (state, value) => ({
          ...state,
          prefs: value as State["prefs"],
        }),
        key: "prefs",
        select: (state) => state.prefs,
      },
    ];
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const results: Array<{ commandId: string; status: string }> = [];
    target.addEventListener("nusm:commandResult", (event) =>
      results.push((event as CustomEvent).detail.payload),
    );
    const store = createNusmStore<State>(
      { prefs: { theme: "light" } },
      {
        adapter,
        devtools: true,
        persist: { slices, strategy: "slices" },
        storeId: "slice-validation",
      },
    );
    await store.ready;
    const replace = (commandId: string, value: unknown) =>
      target.dispatchEvent(
        new CustomEvent("nusm:command", {
          detail: {
            payload: {
              action: "replace_persisted",
              commandId,
              instanceId: store.devtoolsInstanceId,
              storeId: "slice-validation",
              value,
            },
          },
        }),
      );
    replace("not-object", []);
    replace("missing-key", {});
    replace("valid", { prefs: { theme: "dark" } });
    await tick();
    await tick();
    expect(
      results.find((result) => result.commandId === "not-object")?.status,
    ).toBe("error");
    expect(
      results.find((result) => result.commandId === "missing-key")?.status,
    ).toBe("error");
    expect(results.find((result) => result.commandId === "valid")?.status).toBe(
      "success",
    );
    expect(data.get("nusm:slice-validation:slice:prefs")).toEqual({
      theme: "dark",
    });
    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
  });
});
