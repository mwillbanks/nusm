import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { NusmAdapter } from "../../src";
import { createNusmStore } from "../../src";
import { NusmDevtoolsPanel } from "../../src/devtools/panel";
import { removeValueAtPath, setValueAtPath } from "../../src/devtools/path";

afterEach(cleanup);

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

const snapshot = (
  storeId: string,
  adapterName?: string,
  eventLogCap = 100,
) => ({
  adapterName,
  eventLogCap,
  hydration: { byKey: {}, overall: "hydrated" },
  instanceId: storeId,
  isReady: true,
  memory: { profile: { name: "Ada" }, tags: ["state"] },
  persisted: adapterName
    ? { profile: { name: "Ada" }, tags: ["state"] }
    : undefined,
  storeId,
});

describe("review finding remediations", () => {
  test("rejects nested array string properties, gaps, and missing removals", () => {
    const root = { groups: [{ members: ["Ada"] }] };
    expect(() =>
      setValueAtPath(root, ["groups", 0, "members", "hidden"], "Grace"),
    ).toThrow("numeric");
    expect(() =>
      setValueAtPath(root, ["groups", 0, "members", 3], "Grace"),
    ).toThrow("outside");
    expect(() => removeValueAtPath(root, ["groups", 0, "members", 2])).toThrow(
      "outside",
    );
  });

  test("serializes concurrent persisted read-modify-write commands", async () => {
    const values = new Map<string, unknown>([
      ["nusm:concurrent:entire", { profile: { name: "Ada" } }],
    ]);
    const adapter: NusmAdapter = {
      getItem: async (key) => {
        await new Promise((resolve) => setTimeout(resolve, 4));
        return values.get(key) ?? null;
      },
      name: "delayed",
      pacer: false,
      removeItem: (key) => values.delete(key),
      setItem: async (key, value) => {
        await new Promise((resolve) => setTimeout(resolve, 4));
        values.set(key, value);
      },
    };
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const store = createNusmStore(
      { profile: { name: "Ada" } },
      {
        adapter,
        devtools: true,
        persist: { strategy: "entire" },
        storeId: "concurrent",
      },
    );
    await store.ready;
    const command = (commandId: string, path: string[], value: unknown) =>
      target.dispatchEvent(
        new CustomEvent("nusm:command", {
          detail: {
            payload: {
              action: "set_path",
              commandId,
              instanceId: store.devtoolsInstanceId,
              location: "persisted",
              path,
              storeId: "concurrent",
              value,
            },
          },
        }),
      );
    command("role", ["profile", "role"], "engineer");
    command("team", ["profile", "team"], "platform");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(values.get("nusm:concurrent:entire")).toEqual({
      profile: { name: "Ada", role: "engineer", team: "platform" },
    });
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });

  test("correlates acknowledgements and confirms destructive commands", () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const commands: Array<Record<string, unknown>> = [];
    target.addEventListener("nusm:command", (event) =>
      commands.push((event as CustomEvent).detail.payload),
    );
    const view = render(<NusmDevtoolsPanel devtoolsOpen theme="dark" />);
    dispatch(target, "snapshot", snapshot("persisted", "localStorage"));
    fireEvent.click(view.getByRole("tab", { name: "memory" }));
    fireEvent.click(view.getByRole("button", { name: "Refresh" }));
    const refresh = commands.at(-1);
    dispatch(target, "commandResult", {
      action: "refresh",
      commandId: "foreign-command",
      error: "Foreign failure",
      instanceId: "persisted",
      status: "error",
      storeId: "persisted",
    });
    expect(view.queryByText("Foreign failure")).not.toBeInTheDocument();
    dispatch(target, "commandResult", {
      action: "refresh",
      commandId: refresh?.commandId,
      error: "Expected failure",
      instanceId: "persisted",
      status: "error",
      storeId: "persisted",
    });
    expect(view.getByText("Expected failure")).toBeInTheDocument();

    fireEvent.click(view.getByText("name"));
    const before = commands.length;
    fireEvent.click(view.getByRole("button", { name: "Remove" }));
    expect(
      view.getByRole("dialog", { name: "remove value" }),
    ).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Close editor" }));
    expect(commands).toHaveLength(before);
    fireEvent.click(view.getByRole("button", { name: "Remove" }));
    fireEvent.click(view.getByRole("button", { name: "Confirm remove" }));
    expect(commands.at(-1)).toMatchObject({
      action: "remove_path",
      path: ["profile", "name"],
    });
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });

  test("reports copy failures and supports the clipboard fallback", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("Clipboard denied")) },
    });
    const view = render(<NusmDevtoolsPanel devtoolsOpen theme="dark" />);
    dispatch(target, "snapshot", snapshot("copy", "sessionStorage"));
    fireEvent.click(view.getByRole("tab", { name: "memory" }));
    fireEvent.click(view.getByRole("button", { name: "Copy location" }));
    await act(async () => Promise.resolve());
    expect(view.getByText("Clipboard denied")).toBeInTheDocument();

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => true,
    });
    fireEvent.click(view.getByText("name"));
    fireEvent.click(view.getByRole("button", { name: "Copy value" }));
    await act(async () => Promise.resolve());
    expect(view.getByText("Copied value")).toBeInTheDocument();
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });

  test("normalizes memory-only navigation and honors snapshot event caps", () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const view = render(<NusmDevtoolsPanel devtoolsOpen theme="dark" />);
    dispatch(target, "snapshot", snapshot("persisted", "indexdb", 2));
    dispatch(target, "snapshot", snapshot("memory-only", undefined, 2));
    fireEvent.click(view.getByRole("button", { name: /persisted/i }));
    fireEvent.click(view.getByRole("tab", { name: "indexdb" }));
    fireEvent.click(view.getByRole("button", { name: /memory-only/i }));
    expect(view.getByRole("tab", { name: "memory" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      view.queryByRole("tab", { name: "indexdb" }),
    ).not.toBeInTheDocument();

    for (const [detail, ts] of [
      ["first", 1],
      ["second", 2],
      ["third", 3],
    ] as const) {
      dispatch(target, "event", {
        detail,
        instanceId: "memory-only",
        storeId: "memory-only",
        ts,
        type: "state_change",
      });
    }
    fireEvent.click(view.getByRole("button", { name: "Timeline" }));
    expect(view.queryByText(/first/)).not.toBeInTheDocument();
    expect(view.getByText(/second/)).toBeInTheDocument();
    expect(view.getByText(/third/)).toBeInTheDocument();
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });
});
