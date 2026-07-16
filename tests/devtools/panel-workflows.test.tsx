import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { NusmDevtoolsPanel } from "../../src/devtools/panel";
import { NusmDevtoolsCore } from "../../src/devtools/plugin";

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

const dispatch = async (
  target: EventTarget,
  type: string,
  payload: unknown,
) => {
  await act(async () => {
    target.dispatchEvent(
      new CustomEvent(`nusm:${type}`, { detail: { payload } }),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
};

describe("devtools panel workflows", () => {
  test("navigates, copies, removes, refreshes, receives results, and opens raw editing", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const commands: Array<Record<string, unknown>> = [];
    target.addEventListener("nusm:command", (event) =>
      commands.push((event as CustomEvent).detail.payload),
    );
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (value: string) => {
          copied.push(value);
          return Promise.resolve();
        },
      },
    });

    const view = render(<NusmDevtoolsPanel devtoolsOpen theme="light" />);
    expect(view.getByText("No instrumented stores yet")).toBeInTheDocument();
    await dispatch(target, "snapshot", {
      adapterName: "indexdb",
      eventLogCap: 2,
      hydration: { byKey: { entire: "hydrated" }, overall: "hydrated" },
      instanceId: "workspace-instance",
      isReady: true,
      memory: { profile: { name: "Ada" }, tags: ["devtools"] },
      persisted: { profile: { name: "Ada" }, tags: ["devtools"] },
      storeId: "workspace",
    });

    fireEvent.click(view.getByRole("button", { name: /workspace/i }));
    fireEvent.click(view.getByRole("tab", { name: "memory" }));
    act(() => {
      fireEvent.input(view.getByLabelText("Search keys and values"), {
        target: { value: "__missing__" },
      });
    });
    expect(view.getByText("No paths match this filter")).toBeInTheDocument();
    fireEvent.input(view.getByLabelText("Search keys and values"), {
      target: { value: "" },
    });
    fireEvent.click(view.getByRole("button", { name: "Refresh" }));
    fireEvent.click(view.getByText("name"));
    fireEvent.click(view.getByRole("button", { name: "Copy value" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(copied).toEqual(['"Ada"']);
    (() => {
      fireEvent.click(view.getByRole("button", { name: "Remove" }));
      fireEvent.click(view.getByRole("button", { name: "Confirm remove" }));
    })();
    expect(commands.at(-1)).toMatchObject({
      action: "remove_path",
      path: ["profile", "name"],
    });

    fireEvent.click(view.getByRole("button", { name: "Edit raw JSON" }));
    expect(view.getByRole("dialog", { name: "raw value" })).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Reset memory" }));
    await (async () => {
      await dispatch(target, "commandResult", {
        action: commands.at(-1)?.action,
        commandId: commands.at(-1)?.commandId,
        instanceId: commands.at(-1)?.instanceId,
        status: "definitely-invalid",
        storeId: commands.at(-1)?.storeId,
      });
      expect(
        view.getByRole("dialog", { name: "raw value" }),
      ).toBeInTheDocument();
      expect(view.getByText("reset memory pending…")).toBeInTheDocument();
      expect(view.container.querySelector(".nusm-status.ok")).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Close editor" }));
    })();
    fireEvent.click(view.getByRole("button", { name: "Refresh all stores" }));
    expect(commands.at(-1)).toMatchObject({
      action: "refresh",
      storeId: "workspace",
    });

    await dispatch(target, "event", {
      detail: "set_path",
      instanceId: "workspace-instance",
      storeId: "workspace",
      ts: 10,
      type: "devtools_command",
    });
    fireEvent.click(view.getByRole("button", { name: "Timeline" }));
    expect(view.getByText("devtools_command")).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "About" }));
    expect(
      view.getByText(
        "Bidirectional state inspection powered by TanStack Devtools.",
      ),
    ).toBeInTheDocument();

    await dispatch(target, "commandResult", {
      action: "refresh",
      commandId: commands.at(-1)?.commandId,
      error: "Adapter unavailable",
      instanceId: "workspace-instance",
      status: "error",
      storeId: "workspace",
    });
    expect(view.getByText("Adapter unavailable")).toBeInTheDocument();
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });

  test("mounts and unmounts the devtools core bridge", async () => {
    const core = new NusmDevtoolsCore();
    const root = document.createElement("div");
    document.body.append(root);
    act(() => {
      core.mount(root, { devtoolsOpen: true, theme: "dark" });
      core.mount(root, { devtoolsOpen: true, theme: "light" });
    });
    expect(
      root.querySelector("[data-testid=nusm-devtools-panel]"),
    ).not.toBeNull();
    await act(async () => {
      core.unmount();
      await Promise.resolve();
    });
    expect(root.childElementCount).toBe(0);
    root.remove();
  });
});
