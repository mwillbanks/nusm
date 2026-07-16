import { describe, expect, test } from "bun:test";
import type { NusmAdapter } from "../../src";
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

describe("bidirectional devtools commands", () => {
  test("adds, edits, and removes memory and adapter paths with results", async () => {
    const values = new Map<string, unknown>([
      ["nusm:profile:entire", { profile: { name: "Ada" }, tags: ["state"] }],
    ]);
    const adapter: NusmAdapter = {
      getItem: (key) => values.get(key) ?? null,
      name: "memory-adapter",
      pacer: false,
      removeItem: (key) => {
        values.delete(key);
      },
      setItem: (key, value) => {
        values.set(key, value);
      },
    };
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const results: Array<{ commandId: string; status: string }> = [];
    target.addEventListener("nusm:commandResult", (event) =>
      results.push((event as CustomEvent).detail.payload),
    );
    const store = createNusmStore(
      { profile: { name: "Ada" }, tags: ["state"] },
      {
        adapter,
        devtools: true,
        persist: { strategy: "entire" },
        storeId: "profile",
      },
    );
    await store.ready;
    store.setState((state) => state);
    await tick();

    const command = (payload: Record<string, unknown>) =>
      target.dispatchEvent(
        new CustomEvent("nusm:command", {
          detail: {
            payload: {
              instanceId: store.devtoolsInstanceId,
              storeId: "profile",
              ...payload,
            },
          },
        }),
      );
    command({
      action: "set_path",
      commandId: "edit-memory",
      location: "memory",
      path: ["profile", "name"],
      value: "Grace",
    });
    await tick();
    expect(store.state.profile.name).toBe("Grace");

    command({
      action: "set_path",
      commandId: "add-persisted",
      location: "persisted",
      path: ["profile", "role"],
      value: "engineer",
    });
    await tick();
    expect(values.get("nusm:profile:entire")).toEqual({
      profile: { name: "Ada", role: "engineer" },
      tags: ["state"],
    });

    command({
      action: "remove_path",
      commandId: "remove-memory",
      location: "memory",
      path: ["tags", 0],
    });
    await tick();
    expect(store.state.tags).toEqual([]);
    target.dispatchEvent(
      new CustomEvent("nusm:command", {
        detail: {
          payload: { action: "refresh_all", commandId: "refresh-all" },
        },
      }),
    );
    await tick();
    expect(results.map((result) => result.commandId)).toEqual(
      expect.arrayContaining([
        "edit-memory",
        "add-persisted",
        "remove-memory",
        "refresh-all",
      ]),
    );
    expect(results.every((result) => result.status === "success")).toBe(true);
    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
  });
});
