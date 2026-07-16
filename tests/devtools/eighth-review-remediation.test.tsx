import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { NusmDevtoolsPanel } from "../../src/devtools/panel";

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

afterEach(cleanup);

describe("eighth semantic review remediations", () => {
  test("counts enumerable accessors consistently without evaluating them", () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    let getterCalls = 0;
    const memory = {};
    Object.defineProperty(memory, "visible", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error("must not execute");
      },
    });
    const view = render(<NusmDevtoolsPanel devtoolsOpen theme="dark" />);
    act(() =>
      target.dispatchEvent(
        new CustomEvent("nusm:snapshot", {
          detail: {
            payload: {
              hydration: { byKey: {}, overall: "hydrated" },
              instanceId: "accessor-store-instance",
              isReady: true,
              memory,
              storeId: "accessor-store",
              synchronization: "not_applicable",
            },
          },
        }),
      ),
    );
    expect(view.getByText("1 memory keys")).toBeInTheDocument();
    fireEvent.click(view.getByRole("tab", { name: "memory" }));
    expect(view.getByText("visible")).toBeInTheDocument();
    expect(view.getByText("[Accessor not evaluated]")).toBeInTheDocument();
    expect(getterCalls).toBe(0);
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });
});
