import { afterEach, describe, expect, jest, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import type {
  AdapterEvent,
  NusmAdapter,
  NusmDevtoolsSnapshot,
  PersistSlice,
} from "../../src";
import { createNusmStore } from "../../src";
import { NusmDevtoolsPanel } from "../../src/devtools/panel";

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
const command = (target: EventTarget, payload: Record<string, unknown>) =>
  target.dispatchEvent(
    new CustomEvent("nusm:command", { detail: { payload } }),
  );
const sendSnapshot = (target: EventTarget, payload: NusmDevtoolsSnapshot) =>
  act(() =>
    target.dispatchEvent(
      new CustomEvent("nusm:snapshot", { detail: { payload } }),
    ),
  );

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("sixth semantic review remediations", () => {
  test("derives entire-store health for every memory command and no-op persisted writes", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const key = "nusm:entire-health:entire";
    const values = new Map<string, unknown>([[key, { x: 1, y: 1 }]]);
    const snapshots: NusmDevtoolsSnapshot[] = [];
    target.addEventListener("nusm:snapshot", (event) =>
      snapshots.push((event as CustomEvent).detail.payload),
    );
    const adapter: NusmAdapter = {
      getItem: (storageKey) => values.get(storageKey) ?? null,
      name: "entire-health",
      pacer: false,
      removeItem: (storageKey) => values.delete(storageKey),
      setItem: (storageKey, value) => values.set(storageKey, value),
    };
    const store = createNusmStore(
      { x: 1, y: 1 },
      {
        adapter,
        devtools: true,
        persist: { strategy: "entire" },
        storeId: "entire-health",
      },
    );
    await store.ready;
    const run = async (payload: Record<string, unknown>) => {
      command(target, {
        instanceId: store.devtoolsInstanceId,
        storeId: "entire-health",
        ...payload,
      });
      await tick();
      return snapshots.at(-1)?.synchronization;
    };

    expect(
      await run({
        action: "set_path",
        commandId: "memory-set",
        location: "memory",
        path: ["x"],
        value: 2,
      }),
    ).toBe("diverged");
    expect(
      await run({
        action: "replace_memory",
        commandId: "memory-replace",
        value: { x: 3, y: 3 },
      }),
    ).toBe("diverged");
    expect(
      await run({
        action: "remove_path",
        commandId: "memory-remove",
        location: "memory",
        path: ["y"],
      }),
    ).toBe("diverged");
    expect(
      await run({ action: "reset_memory", commandId: "memory-reset" }),
    ).toBe("synchronized");
    expect(
      await run({
        action: "replace_persisted",
        commandId: "persisted-noop",
        value: { x: 1, y: 1 },
      }),
    ).toBe("synchronized");
    expect(store.state).toEqual({ x: 1, y: 1 });
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });

  test("keeps aggregate slice health divergent across unrelated flushes and events", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const aKey = "nusm:slice-health:slice:a";
    const bKey = "nusm:slice-health:slice:b";
    const values = new Map<string, unknown>([
      [aKey, 1],
      [bKey, 2],
    ]);
    let now = 0;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const listeners = new Set<(event: AdapterEvent) => void>();
    const snapshots: NusmDevtoolsSnapshot[] = [];
    target.addEventListener("nusm:snapshot", (event) =>
      snapshots.push((event as CustomEvent).detail.payload),
    );
    const adapter: NusmAdapter = {
      getItem: (key) => values.get(key) ?? null,
      name: "slice-health",
      pacer: false,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const slice = (key: "a" | "b"): PersistSlice<{ a: number; b: number }> => ({
      apply: (state, value) => ({ ...state, [key]: value as number }),
      key,
      select: (state) => state[key],
    });
    const store = createNusmStore(
      { a: 1, b: 2 },
      {
        adapter,
        devtools: true,
        persist: { slices: [slice("a"), slice("b")], strategy: "slices" },
        storeId: "slice-health",
      },
    );
    await store.ready;
    command(target, {
      action: "set_path",
      commandId: "diverge-a",
      instanceId: store.devtoolsInstanceId,
      location: "persisted",
      path: ["a"],
      storeId: "slice-health",
      value: 9,
    });
    await tick();
    expect(snapshots.at(-1)?.synchronization).toBe("diverged");

    store.setState((state) => ({ ...state, b: 3 }));
    await tick();
    await tick();
    expect(values.get(bKey)).toBe(3);
    expect(snapshots.at(-1)?.synchronization).toBe("diverged");

    now = 2_000;
    values.set(bKey, 4);
    for (const listener of listeners) listener({ key: bKey, type: "set" });
    await tick();
    expect(store.state).toEqual({ a: 1, b: 4 });
    expect(snapshots.at(-1)?.synchronization).toBe("diverged");

    command(target, {
      action: "set_path",
      commandId: "resync-a",
      instanceId: store.devtoolsInstanceId,
      location: "persisted",
      path: ["a"],
      storeId: "slice-health",
      value: 1,
    });
    await tick();
    expect(snapshots.at(-1)?.synchronization).toBe("synchronized");
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });

  test("uses neutral adapter wording alongside divergence health", () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const view = render(<NusmDevtoolsPanel devtoolsOpen theme="dark" />);
    sendSnapshot(target, {
      adapterName: "localStorage",
      hydration: { byKey: { entire: "hydrated" }, overall: "hydrated" },
      instanceId: "truthful-copy-instance",
      isReady: true,
      memory: { value: 2 },
      persisted: { value: 1 },
      storeId: "truthful-copy",
      synchronization: "diverged",
    });
    expect(view.getByText("Memory and adapter diverged")).toBeInTheDocument();
    expect(
      view.getByText("Persisted through localStorage"),
    ).toBeInTheDocument();
    expect(view.queryByText(/Mirrored through/)).not.toBeInTheDocument();
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });
});
