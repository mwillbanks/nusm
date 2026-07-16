import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type {
  AdapterEvent,
  NusmAdapter,
  NusmDevtoolsSnapshot,
} from "../../src";
import { createNusmStore } from "../../src";
import { NusmDevtoolsPanel } from "../../src/devtools/panel";
import { flattenValue } from "../../src/devtools/panel-model";
import {
  getValueAtPath,
  removeValueAtPath,
  setValueAtPath,
} from "../../src/devtools/path";
import { stringifyForDevtools } from "../../src/devtools/serialize";

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
const send = (target: EventTarget, type: string, payload: unknown) =>
  act(() =>
    target.dispatchEvent(
      new CustomEvent(`nusm:${type}`, { detail: { payload } }),
    ),
  );
const command = (target: EventTarget, payload: Record<string, unknown>) =>
  target.dispatchEvent(
    new CustomEvent("nusm:command", { detail: { payload } }),
  );
const panelSnapshot = (
  overrides: Partial<NusmDevtoolsSnapshot> = {},
): NusmDevtoolsSnapshot => ({
  adapterName: "localStorage",
  hydration: { byKey: { entire: "hydrated" }, overall: "hydrated" },
  instanceId: "review-instance",
  isReady: true,
  memory: { value: 1 },
  persisted: { value: 1 },
  storeId: "review",
  synchronization: "diverged",
  ...overrides,
});

afterEach(() => cleanup());

describe("fourth semantic review remediations", () => {
  test("edits only own data properties without invoking getters or inherited paths", () => {
    let getterCalls = 0;
    const root = { profile: { name: "Ada" } };
    Object.defineProperty(root, "unrelated", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "secret";
      },
    });
    expect(() => setValueAtPath(root, ["profile", "name"], "Grace")).toThrow(
      "Accessor properties cannot be edited",
    );
    expect(getterCalls).toBe(0);

    const inherited = Object.create({ inherited: 1 }) as Record<
      string,
      unknown
    >;
    expect(getValueAtPath(inherited, ["inherited"])).toBeUndefined();
    expect(() => removeValueAtPath(inherited, ["inherited"])).toThrow(
      "selected path does not exist",
    );
  });

  test("serializes hostile prototype keys without mutating object prototypes", () => {
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, "__proto__", {
      enumerable: true,
      value: { polluted: true },
    });
    const rendered = stringifyForDevtools(hostile);
    expect(rendered).toContain('"__proto__"');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  test("does not feed a direct persisted edit back into memory and records successful writes", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const listeners = new Set<(event: AdapterEvent) => void>();
    const values = new Map<string, unknown>([
      ["nusm:echo:entire", { count: 1 }],
    ]);
    const snapshots: NusmDevtoolsSnapshot[] = [];
    target.addEventListener("nusm:snapshot", (event) =>
      snapshots.push((event as CustomEvent).detail.payload),
    );
    const adapter: NusmAdapter = {
      getItem: (key) => values.get(key) ?? null,
      name: "self-notifying-localStorage",
      pacer: false,
      removeItem: (key) => {
        values.delete(key);
        for (const listener of listeners) listener({ key, type: "remove" });
      },
      setItem: (key, value) => {
        values.set(key, value);
        for (const listener of listeners) listener({ key, type: "set" });
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const store = createNusmStore(
      { count: 1 },
      {
        adapter,
        devtools: true,
        persist: { strategy: "entire" },
        storeId: "echo",
      },
    );
    await store.ready;
    command(target, {
      action: "set_path",
      commandId: "persisted-only",
      instanceId: store.devtoolsInstanceId,
      location: "persisted",
      path: ["count"],
      storeId: "echo",
      value: 9,
    });
    await tick();
    await tick();
    expect(store.state).toEqual({ count: 1 });
    expect(values.get("nusm:echo:entire")).toEqual({ count: 9 });
    expect(snapshots.at(-1)?.lastFlushAt).toBeNumber();
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });

  test("does not report failed adapter writes as a successful last flush", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const snapshots: NusmDevtoolsSnapshot[] = [];
    target.addEventListener("nusm:snapshot", (event) =>
      snapshots.push((event as CustomEvent).detail.payload),
    );
    const adapter: NusmAdapter = {
      getItem: () => null,
      name: "failing",
      pacer: false,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error("write denied");
      },
    };
    const store = createNusmStore(
      { count: 1 },
      {
        adapter,
        devtools: true,
        persist: { strategy: "entire" },
        storeId: "failure",
      },
    );
    await store.ready;
    store.setState(() => ({ count: 2 }));
    await tick();
    expect(snapshots.at(-1)?.lastFlushAt).toBeUndefined();
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });

  test("uses storage icons, honest health, list semantics, and progressive limits", () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const many = Object.fromEntries(
      Array.from({ length: 2_001 }, (_, index) => [`key-${index}`, index]),
    );
    const view = render(<NusmDevtoolsPanel devtoolsOpen theme="dark" />);
    send(
      target,
      "snapshot",
      panelSnapshot({ memory: many, pendingKeys: [], persisted: { value: 2 } }),
    );
    expect(view.container.querySelector(".lucide-hard-drive")).not.toBeNull();
    expect(
      view.getAllByLabelText("Memory and adapter diverged").length,
    ).toBeGreaterThan(0);
    fireEvent.click(view.getByRole("tab", { name: "memory" }));
    expect(
      view.getByRole("list", { name: "Store values" }),
    ).toBeInTheDocument();
    expect(view.queryByRole("tree")).not.toBeInTheDocument();
    const more = view.getByRole("button", { name: /Show more values/ });
    fireEvent.click(more);
    expect(
      view.queryByRole("button", { name: /Show more values/ }),
    ).not.toBeInTheDocument();
    expect(view.getByText("key-2000")).toBeInTheDocument();

    send(
      target,
      "snapshot",
      panelSnapshot({
        hydration: { byKey: { entire: "error" }, overall: "error" },
        isReady: true,
      }),
    );
    expect(view.getAllByLabelText("Hydration error").length).toBeGreaterThan(0);
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  }, 15_000);

  test("emits explicit truncation sentinels instead of silently dropping values", () => {
    const rows = flattenValue({ a: 1, b: 2, c: 3 }, "", [], { maxNodes: 2 });
    expect(rows.at(-1)).toMatchObject({
      key: "Show more values",
      truncated: "nodes",
    });
  });
});
