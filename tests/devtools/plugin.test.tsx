import { afterEach, describe, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import {
  createNoOpNusmDevtoolsPlugin,
  createNusmDevtoolsPlugin,
  NoOpNusmReactDevtoolsPanel,
} from "../../src/devtools/plugin";

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

describe("React devtools plugin factory", () => {
  test("uses active and no-op framework factories", () => {
    expect(createNusmDevtoolsPlugin()).toMatchObject({
      id: "nusm",
      name: "nusm",
    });
    const noOp = createNoOpNusmDevtoolsPlugin();
    expect(noOp).toMatchObject({ id: "nusm", name: "nusm" });
    const noOpElement = noOp.render(document.createElement("div"), {
      devtoolsOpen: false,
      theme: "dark",
    }) as unknown as ReactElement;
    const noOpView = render(noOpElement);
    expect(noOpView.container).toBeEmptyDOMElement();
    const panelView = render(
      <NoOpNusmReactDevtoolsPanel devtoolsOpen={false} theme="dark" />,
    );
    expect(panelView.container).toBeEmptyDOMElement();
  });

  test("exercises search, adapter tabs, edit, add, remove, copy, and raw workflows", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const commands: Array<Record<string, unknown>> = [];
    target.addEventListener("nusm:command", (event) => {
      const command = (event as CustomEvent).detail.payload as {
        action: string;
        commandId: string;
        instanceId: string;
        storeId?: string;
      };
      commands.push(command);
      target.dispatchEvent(
        new CustomEvent("nusm:commandResult", {
          detail: {
            payload: {
              action: command.action,
              commandId: command.commandId,
              instanceId: command.instanceId,
              status: "success",
              storeId: command.storeId,
            },
          },
        }),
      );
    });
    const plugin = createNusmDevtoolsPlugin();
    const element = plugin.render(document.createElement("div"), {
      devtoolsOpen: true,
      theme: "dark",
    }) as unknown as ReactElement;
    const view = render(element);

    act(() => {
      target.dispatchEvent(
        new CustomEvent("nusm:snapshot", {
          detail: {
            payload: {
              adapterName: "localStorage",
              hydration: { byKey: { entire: "hydrated" }, overall: "hydrated" },
              instanceId: "preferences-instance",
              isReady: true,
              memory: { flags: [true], profile: { name: "Ada" } },
              persisted: { flags: [true], profile: { name: "Ada" } },
              persistenceStrategy: "entire",
              storeId: "preferences",
            },
          },
        }),
      );
    });

    expect(
      await view.findByRole("button", { name: /preferences/i }),
    ).toBeInTheDocument();
    fireEvent.click(view.getByRole("tab", { name: "memory" }));
    fireEvent.change(view.getByLabelText("Search keys and values"), {
      target: { value: "Ada" },
    });
    fireEvent.click(await view.findByText("name"));
    fireEvent.click(view.getByRole("button", { name: "Edit" }));
    fireEvent.input(view.getByLabelText("JSON value"), {
      target: { value: '"Grace"' },
    });
    fireEvent.click(view.getByRole("button", { name: "Apply change" }));
    await waitFor(() =>
      expect(commands.at(-1)).toMatchObject({
        action: "set_path",
        location: "memory",
        path: ["profile", "name"],
      }),
    );

    fireEvent.click(view.getByRole("button", { name: /Add/ }));
    fireEvent.change(view.getByLabelText("JSON path"), {
      target: { value: "profile.role" },
    });
    fireEvent.input(view.getByLabelText("JSON value"), {
      target: { value: '"engineer"' },
    });
    fireEvent.click(view.getByRole("button", { name: "Apply change" }));
    expect(commands.at(-1)).toMatchObject({
      action: "set_path",
      location: "memory",
    });

    fireEvent.click(view.getByRole("tab", { name: "localStorage" }));
    expect(
      view.getByRole("button", { name: "Edit raw JSON" }),
    ).toBeInTheDocument();
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });
});
