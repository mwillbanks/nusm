import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
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

afterEach(() => {
  cleanup();
  delete globalThis.__TANSTACK_EVENT_TARGET__;
});

describe("final review remediation", () => {
  test("seeds an interacting missing slice from initial state without divergence", async () => {
    type State = { mirror: string; profile: { name: string } };
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const snapshots: NusmDevtoolsSnapshot[] = [];
    target.addEventListener("nusm:snapshot", (event) =>
      snapshots.push((event as CustomEvent).detail.payload),
    );
    const values = new Map<string, unknown>([
      ["nusm:interacting-slices:slice:profile", { name: "Persisted" }],
    ]);
    const adapter: NusmAdapter = {
      getItem: (key) => values.get(key) ?? null,
      name: "interacting-memory",
      pacer: false,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
    };
    const slices: Array<PersistSlice<State>> = [
      {
        apply: (state, value) => ({
          ...state,
          mirror: `derived:${(value as State["profile"]).name}`,
          profile: value as State["profile"],
        }),
        key: "profile",
        select: (state) => state.profile,
      },
      {
        apply: (state, value) => ({ ...state, mirror: value as string }),
        key: "mirror",
        select: (state) => state.mirror,
      },
    ];
    const store = createNusmStore<State>(
      { mirror: "initial-mirror", profile: { name: "Initial" } },
      {
        adapter,
        devtools: true,
        persist: { slices, strategy: "slices" },
        storeId: "interacting-slices",
      },
    );

    await store.ready;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.state).toEqual({
      mirror: "initial-mirror",
      profile: { name: "Persisted" },
    });
    expect(values.get("nusm:interacting-slices:slice:mirror")).toBe(
      "initial-mirror",
    );
    expect(snapshots.at(-1)).toMatchObject({
      pendingKeys: [],
      synchronization: "synchronized",
    });
  });

  test("implements the keyboard tab and tabpanel contract", async () => {
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const view = render(<NusmDevtoolsPanel devtoolsOpen theme="dark" />);
    await act(async () => {
      target.dispatchEvent(
        new CustomEvent("nusm:snapshot", {
          detail: {
            payload: {
              adapterName: "indexdb",
              hydration: { byKey: { entire: "hydrated" }, overall: "hydrated" },
              instanceId: "accessible-store-instance",
              isReady: true,
              memory: { value: 1 },
              persisted: { value: 1 },
              storeId: "accessible-store",
            },
          },
        }),
      );
      await Promise.resolve();
    });
    fireEvent.click(view.getByRole("button", { name: /accessible-store/i }));

    const overview = view.getByRole("tab", { name: "overview" });
    expect(overview).toHaveAttribute("aria-selected", "true");
    expect(overview).toHaveAttribute("tabindex", "0");
    const overviewPanel = view.getByRole("tabpanel");
    expect(overview).toHaveAttribute("aria-controls", overviewPanel.id);
    expect(overviewPanel).toHaveAttribute("aria-labelledby", overview.id);

    fireEvent.keyDown(overview, { key: "ArrowRight" });
    const memory = view.getByRole("tab", { name: "memory" });
    expect(memory).toHaveFocus();
    expect(memory).toHaveAttribute("aria-selected", "true");
    expect(view.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      memory.id,
    );

    fireEvent.keyDown(memory, { key: "End" });
    const about = view.getByRole("tab", { name: "about" });
    expect(about).toHaveFocus();
    fireEvent.keyDown(about, { key: "Home" });
    expect(overview).toHaveFocus();
    fireEvent.keyDown(overview, { key: "ArrowLeft" });
    expect(about).toHaveFocus();
  });
});
