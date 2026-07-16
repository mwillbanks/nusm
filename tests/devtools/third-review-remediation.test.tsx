import { afterEach, describe, expect, jest, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { NusmAdapter, PersistSlice } from "../../src";
import { createNusmStore } from "../../src";
import { NusmDevtoolsPanel } from "../../src/devtools/panel";
import {
  flattenValue,
  formatPath,
  parsePath,
} from "../../src/devtools/panel-model";
import { stringifyForDevtools } from "../../src/devtools/serialize";

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

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
const dispatch = (target: EventTarget, type: string, payload: unknown) =>
  act(() =>
    target.dispatchEvent(
      new CustomEvent(`nusm:${type}`, { detail: { payload } }),
    ),
  );
const snapshot = (
  storeId: string,
  isReady = true,
  memory: unknown = { name: storeId },
) => ({
  adapterName: "localStorage",
  eventLogCap: 20,
  hydration: { byKey: {}, overall: isReady ? "hydrated" : "pending" },
  instanceId: storeId,
  isReady,
  memory,
  persisted: memory,
  storeId,
});

describe("third semantic review remediations", () => {
  test("uses reversible paths and safely bounds hostile state inspection", () => {
    const path = ["a.b", "x[0]", ""];
    expect(parsePath(formatPath(path))).toEqual(path);
    expect(parsePath('$["a.b"]["x[0]"][""]')).toEqual(path);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    let getterCalls = 0;
    Object.defineProperty(circular, "secret", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error("getter executed");
      },
    });
    const rows = flattenValue(circular);
    expect(rows.find((row) => row.key === "self")?.preview).toContain(
      "Circular",
    );
    expect(rows.find((row) => row.key === "secret")?.preview).toBe(
      "[Accessor not evaluated]",
    );
    expect(getterCalls).toBe(0);

    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("proxy inspected");
        },
      },
    );
    expect(flattenValue(hostile)[0]?.preview).toContain("Uninspectable");

    let toJsonCalls = 0;
    const withToJson = {
      toJSON: () => {
        toJsonCalls += 1;
        return { deceptive: true };
      },
      value: 1,
    };
    expect(stringifyForDevtools(withToJson)).toContain('"value": 1');
    expect(toJsonCalls).toBe(0);
  });

  test("guards hydration, root paths, refresh scope, narrow actions, focus, and event identity", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const commands: Array<Record<string, unknown>> = [];
    target.addEventListener("nusm:command", (event) =>
      commands.push((event as CustomEvent).detail.payload),
    );
    const view = render(<NusmDevtoolsPanel devtoolsOpen theme="dark" />);
    dispatch(target, "snapshot", snapshot("alpha", false));
    expect(view.getByRole("button", { name: "Add" })).toBeDisabled();
    fireEvent.click(view.getByRole("tab", { name: "memory" }));
    expect(view.getByRole("button", { name: "Edit raw JSON" })).toBeDisabled();

    dispatch(
      target,
      "snapshot",
      snapshot("alpha", true, { "a.b": "literal", nested: { value: 1 } }),
    );
    dispatch(target, "snapshot", snapshot("beta"));
    expect(
      view.getByRole("list", { name: "Store values" }),
    ).toBeInTheDocument();
    const literal = view.getByRole("button", { name: /a\.b/ });
    expect(literal).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(literal);
    expect(view.getByRole("button", { name: "Edit" })).toBeVisible();
    expect(
      view.getByRole("button", { name: "Edit" }).closest("aside"),
    ).toHaveClass("is-open");

    const editButton = view.getByRole("button", { name: "Edit" });
    editButton.focus();
    fireEvent.click(editButton);
    expect(document.activeElement).toBe(
      view.getByRole("button", { name: "Close editor" }),
    );
    fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
    expect(view.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(editButton);

    fireEvent.click(view.getByRole("button", { name: "Add" }));
    fireEvent.click(view.getByRole("button", { name: "Apply change" }));
    expect(
      view.getByText(/Add and Edit require a non-root JSON path/),
    ).toBeInTheDocument();
    expect(
      commands.filter((command) => command.action === "set_path"),
    ).toHaveLength(0);
    fireEvent.change(view.getByLabelText("JSON path"), {
      target: { value: "$" },
    });
    fireEvent.click(view.getByRole("button", { name: "Apply change" }));
    expect(
      commands.filter((command) => command.action === "set_path"),
    ).toHaveLength(0);
    fireEvent.click(view.getByRole("button", { name: "Close editor" }));

    fireEvent.change(view.getByLabelText("Search stores"), {
      target: { value: "alpha" },
    });
    fireEvent.click(view.getByRole("button", { name: "Refresh all stores" }));
    const refreshed = commands
      .filter((command) => command.action === "refresh")
      .map((command) => command.storeId);
    expect(refreshed).toEqual(expect.arrayContaining(["alpha", "beta"]));

    dispatch(target, "event", {
      detail: "one",
      instanceId: "alpha",
      storeId: "alpha",
      ts: 10,
      type: "devtools_command",
    });
    dispatch(target, "event", {
      detail: "two",
      instanceId: "alpha",
      storeId: "alpha",
      ts: 10,
      type: "devtools_command",
    });
    fireEvent.click(view.getByRole("button", { name: "Timeline" }));
    expect(view.getAllByText("devtools_command")).toHaveLength(2);
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });

  test("cleans failed clipboard fallbacks and expires lost commands", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const originalExec = document.execCommand;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => {
        throw new Error("copy denied");
      },
    });
    const view = render(<NusmDevtoolsPanel devtoolsOpen theme="dark" />);
    dispatch(target, "snapshot", snapshot("alpha"));
    fireEvent.click(view.getByRole("tab", { name: "memory" }));
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Copy location" }));
      await Promise.resolve();
    });
    expect(document.body.querySelectorAll("textarea")).toHaveLength(0);
    expect(view.getByText("copy denied")).toBeInTheDocument();

    jest.useFakeTimers();
    fireEvent.click(view.getByRole("button", { name: "Refresh" }));
    act(() => jest.advanceTimersByTime(5_000));
    expect(view.getByText(/timed out\. Retry the command/)).toBeInTheDocument();
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: originalExec,
    });
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });

  test("rejects pre-hydration and invalid protocol commands", async () => {
    let resolveHydration: ((value: unknown) => void) | undefined;
    const adapter: NusmAdapter = {
      getItem: () => new Promise((resolve) => (resolveHydration = resolve)),
      name: "delayed",
      pacer: false,
      removeItem: () => undefined,
      setItem: () => undefined,
    };
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const results: Array<Record<string, unknown>> = [];
    target.addEventListener("nusm:commandResult", (event) =>
      results.push((event as CustomEvent).detail.payload),
    );
    const store = createNusmStore(
      { value: 1 },
      {
        adapter,
        devtools: true,
        persist: { strategy: "entire" },
        storeId: "delayed",
      },
    );
    dispatch(target, "command", {
      action: "set_path",
      commandId: "too-early",
      instanceId: store.devtoolsInstanceId,
      location: "memory",
      path: ["value"],
      storeId: "delayed",
      value: 2,
    });
    await tick();
    expect(results.at(-1)).toMatchObject({
      commandId: "too-early",
      status: "error",
    });
    expect(store.state).toBeUndefined();

    dispatch(target, "command", {
      action: "future_action",
      commandId: "unknown",
      instanceId: store.devtoolsInstanceId,
      storeId: "delayed",
    });
    await tick();
    expect(results.at(-1)).toMatchObject({
      commandId: "unknown",
      status: "error",
    });
    resolveHydration?.(null);
    await store.ready;
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });

  test("rolls back multi-slice replacement and preserves unrelated missing slices", async () => {
    type State = { prefs: { theme: string }; session: { draft: string } };
    const data = new Map<string, unknown>([
      ["nusm:atomic:slice:prefs", { theme: "light" }],
      ["nusm:atomic:slice:session", { draft: "saved" }],
    ]);
    let failSessionWrite = false;
    const adapter: NusmAdapter = {
      getItem: (key) => data.get(key) ?? null,
      name: "atomic",
      pacer: false,
      removeItem: (key) => data.delete(key),
      setItem: (key, value) => {
        if (failSessionWrite && key.endsWith(":session"))
          throw new Error("session write failed");
        data.set(key, value);
      },
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
    const results: Array<Record<string, unknown>> = [];
    target.addEventListener("nusm:commandResult", (event) =>
      results.push((event as CustomEvent).detail.payload),
    );
    const store = createNusmStore<State>(
      { prefs: { theme: "light" }, session: { draft: "saved" } },
      {
        adapter,
        devtools: true,
        persist: { slices, strategy: "slices" },
        storeId: "atomic",
      },
    );
    await store.ready;
    failSessionWrite = true;
    dispatch(target, "command", {
      action: "replace_persisted",
      commandId: "atomic-replace",
      instanceId: store.devtoolsInstanceId,
      storeId: "atomic",
      value: { prefs: { theme: "dark" }, session: { draft: "new" } },
    });
    await tick();
    expect(results.at(-1)).toMatchObject({
      commandId: "atomic-replace",
      status: "error",
    });
    expect(data.get("nusm:atomic:slice:prefs")).toEqual({ theme: "light" });
    expect(data.get("nusm:atomic:slice:session")).toEqual({ draft: "saved" });
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });
});
