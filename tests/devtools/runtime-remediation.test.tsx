import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type {
  NusmAdapter,
  NusmDevtoolsSnapshot,
  PersistSlice,
} from "../../src";
import { createNusmStore } from "../../src";
import { NusmDevtoolsPanel } from "../../src/devtools/panel";

const relay = () => {
  const target = new EventTarget();
  target.addEventListener("tanstack-connect", () =>
    target.dispatchEvent(new CustomEvent("tanstack-connect-success")),
  );
  target.addEventListener("tanstack-dispatch-event", (event) => {
    const detail = (event as CustomEvent<{ payload: unknown; type: string }>)
      .detail;
    target.dispatchEvent(new CustomEvent(detail.type, { detail }));
  });
  return target;
};

const memoryAdapter = (initial?: ReadonlyArray<[string, unknown]>) => {
  const values = new Map(initial);
  const writes: Array<{ key: string; value: unknown }> = [];
  const adapter: NusmAdapter = {
    getItem: (key) => values.get(key) ?? null,
    name: "test-storage",
    pacer: false,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => {
      values.set(key, value);
      writes.push({ key, value });
    },
  };
  return { adapter, values, writes };
};

afterEach(() => {
  cleanup();
  delete globalThis.__TANSTACK_EVENT_TARGET__;
});

describe("devtools runtime remediation", () => {
  test("seeds a missing entire state before readiness and reports synchronization", async () => {
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const snapshots: NusmDevtoolsSnapshot[] = [];
    target.addEventListener("nusm:snapshot", (event) =>
      snapshots.push((event as CustomEvent).detail.payload),
    );
    const { adapter, values, writes } = memoryAdapter();
    const store = createNusmStore(
      { enabled: true, theme: "midnight" },
      {
        adapter,
        devtools: true,
        persist: { strategy: "entire" },
        storeId: "initial-baseline",
      },
    );

    await store.ready;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(values.get("nusm:initial-baseline:entire")).toEqual({
      enabled: true,
      theme: "midnight",
    });
    expect(writes).toHaveLength(1);
    expect(store.hydration.overall).toBe("hydrated");
    expect(snapshots.at(-1)).toMatchObject({
      pendingKeys: [],
      persisted: { enabled: true, theme: "midnight" },
      synchronization: "synchronized",
    });
    expect(snapshots.at(-1)?.lastFlushAt).toBeNumber();
  });

  test("seeds only missing slices and preserves hydrated adapter values", async () => {
    type State = {
      preferences: { theme: string };
      session: { drafts: number };
    };
    const preferencesKey = "nusm:sliced-baseline:slice:preferences";
    const sessionKey = "nusm:sliced-baseline:slice:session";
    const { adapter, values, writes } = memoryAdapter([
      [sessionKey, { drafts: 7 }],
    ]);
    const slices: Array<PersistSlice<State>> = [
      {
        apply: (state, value) => ({
          ...state,
          preferences: value as State["preferences"],
        }),
        key: "preferences",
        select: (state) => state.preferences,
      },
      {
        apply: (state, value) => ({
          ...state,
          session: value as State["session"],
        }),
        key: "session",
        select: (state) => state.session,
      },
    ];
    const store = createNusmStore<State>(
      { preferences: { theme: "midnight" }, session: { drafts: 0 } },
      {
        adapter,
        persist: { slices, strategy: "slices" },
        storeId: "sliced-baseline",
      },
    );

    await store.ready;

    expect(store.state.session).toEqual({ drafts: 7 });
    expect(values.get(preferencesKey)).toEqual({ theme: "midnight" });
    expect(values.get(sessionKey)).toEqual({ drafts: 7 });
    expect(writes).toEqual([
      { key: preferencesKey, value: { theme: "midnight" } },
    ]);
    expect(store.hydration.byKey).toEqual({
      preferences: "hydrated",
      session: "hydrated",
    });
  });

  test("renders the canonical nusm mark without browser random UUID support", () => {
    const view = render(<NusmDevtoolsPanel devtoolsOpen theme="dark" />);
    const logo = view.getByRole("img", { name: "nusm inspector logo" });

    expect(logo).toHaveAttribute("viewBox", "0 0 148 78");
    expect(logo.querySelectorAll("ellipse")).toHaveLength(4);
    expect(logo.querySelectorAll("path")).toHaveLength(4);
  });
});
