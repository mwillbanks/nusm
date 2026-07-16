import { afterEach, describe, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import type { NusmAdapter, PersistSlice } from "../../src";
import { createNusmStore } from "../../src";
import { NusmDevtoolsPanel } from "../../src/devtools/panel";
import { parsePath } from "../../src/devtools/panel-model";

afterEach(cleanup);

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
const dispatch = (target: EventTarget, type: string, payload: unknown) => {
  act(() =>
    target.dispatchEvent(
      new CustomEvent(`nusm:${type}`, { detail: { payload } }),
    ),
  );
};
const snapshot = (storeId: string) => ({
  eventLogCap: 10,
  hydration: { byKey: {}, overall: "hydrated" },
  instanceId: storeId,
  isReady: true,
  memory: { profile: { name: storeId } },
  storeId,
});

describe("second semantic review remediations", () => {
  test("binds destructive editor sessions to a store and closes stale sessions", () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const commands: Array<Record<string, unknown>> = [];
    target.addEventListener("nusm:command", (event) =>
      commands.push((event as CustomEvent).detail.payload),
    );
    const view = render(<NusmDevtoolsPanel devtoolsOpen theme="dark" />);
    dispatch(target, "snapshot", snapshot("alpha"));
    dispatch(target, "snapshot", snapshot("beta"));
    fireEvent.click(view.getByRole("tab", { name: "memory" }));
    fireEvent.click(view.getAllByText("name")[0]);
    fireEvent.click(view.getByRole("button", { name: "Remove" }));
    fireEvent.click(view.getByRole("button", { name: "Confirm remove" }));
    expect(commands.at(-1)).toMatchObject({
      action: "remove_path",
      storeId: "alpha",
    });

    fireEvent.click(view.getAllByText("name")[0]);
    fireEvent.click(view.getByRole("button", { name: "Edit" }));
    fireEvent.click(view.getByRole("button", { name: /beta/i }));
    expect(view.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      commands.filter((command) => command.action === "set_path"),
    ).toHaveLength(0);
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });

  test("creates unique command ids for simultaneous panel instances", () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const commands: Array<Record<string, unknown>> = [];
    target.addEventListener("nusm:command", (event) =>
      commands.push((event as CustomEvent).detail.payload),
    );
    const first = render(<NusmDevtoolsPanel devtoolsOpen theme="dark" />);
    const second = render(<NusmDevtoolsPanel devtoolsOpen theme="dark" />);
    const syncIds = commands
      .filter((command) => command.action === "refresh_all")
      .map((command) => command.commandId);
    expect(new Set(syncIds).size).toBe(2);
    dispatch(target, "snapshot", snapshot("shared"));
    fireEvent.click(
      within(first.container).getByRole("button", { name: "Refresh" }),
    );
    fireEvent.click(
      within(second.container).getByRole("button", { name: "Refresh" }),
    );
    const refreshIds = commands
      .filter((command) => command.action === "refresh")
      .map((command) => command.commandId);
    expect(new Set(refreshIds).size).toBe(2);
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });

  test("supports partial slice edits and top-level slice removal", async () => {
    type State = {
      prefs: { theme: string };
      session: { draft: string };
    };
    const data = new Map<string, unknown>([
      ["nusm:slices:slice:prefs", { theme: "light" }],
    ]);
    const adapter: NusmAdapter = {
      getItem: (key) => data.get(key) ?? null,
      name: "partial-slices",
      pacer: false,
      removeItem: (key) => data.delete(key),
      setItem: (key, value) => data.set(key, value),
    };
    const slices: Array<PersistSlice<State>> = [
      {
        apply: (state, value) => ({ ...state, prefs: value as State["prefs"] }),
        key: "prefs",
        select: (state) => state.prefs,
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
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const results: Array<{ commandId: string; status: string }> = [];
    target.addEventListener("nusm:commandResult", (event) =>
      results.push((event as CustomEvent).detail.payload),
    );
    const store = createNusmStore<State>(
      { prefs: { theme: "light" }, session: { draft: "initial" } },
      {
        adapter,
        devtools: true,
        persist: { slices, strategy: "slices" },
        storeId: "slices",
      },
    );
    await store.ready;
    const command = (payload: Record<string, unknown>) =>
      target.dispatchEvent(
        new CustomEvent("nusm:command", { detail: { payload } }),
      );
    command({
      action: "set_path",
      commandId: "partial-edit",
      instanceId: store.devtoolsInstanceId,
      location: "persisted",
      path: ["prefs", "theme"],
      storeId: "slices",
      value: "dark",
    });
    await tick();
    expect(results.at(-1)).toMatchObject({
      commandId: "partial-edit",
      status: "success",
    });
    expect(data.get("nusm:slices:slice:prefs")).toEqual({ theme: "dark" });
    expect(data.get("nusm:slices:slice:session")).toEqual({ draft: "initial" });

    command({
      action: "remove_path",
      commandId: "remove-slice",
      instanceId: store.devtoolsInstanceId,
      location: "persisted",
      path: ["session"],
      storeId: "slices",
    });
    await tick();
    expect(results.at(-1)).toMatchObject({
      commandId: "remove-slice",
      status: "success",
    });
    expect(data.has("nusm:slices:slice:session")).toBe(false);
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });

  test("rejects malformed paths instead of reinterpreting them", () => {
    for (const path of ["a..b", "a[foo]", "a[1", ".a"]) {
      expect(() => parsePath(path)).toThrow("Invalid JSON path");
    }
    expect(parsePath("$.items[0].name")).toEqual(["items", 0, "name"]);
  });

  test("locks the example to the current source checkout", async () => {
    const packageJson = await Bun.file("example/package.json").json();
    const lock = await Bun.file("example/bun.lock").text();
    const tsconfig = await Bun.file("example/tsconfig.json").text();
    expect(packageJson.dependencies.nusm).toBe("file:../src");
    expect(lock).toContain("nusm@file:../src");
    expect(lock).not.toContain("nusm@0.1.0");
    expect(tsconfig).not.toContain('"nusm": [');
  });
});
