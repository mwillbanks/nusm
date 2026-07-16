import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { NusmDevtoolsSnapshot } from "../../src";
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
const sendSnapshot = (target: EventTarget, payload: NusmDevtoolsSnapshot) =>
  act(() =>
    target.dispatchEvent(
      new CustomEvent("nusm:snapshot", { detail: { payload } }),
    ),
  );
const snapshot = (
  storeId: string,
  overrides: Partial<NusmDevtoolsSnapshot>,
): NusmDevtoolsSnapshot => ({
  hydration: { byKey: {}, overall: "hydrated" },
  isReady: true,
  memory: {},
  storeId,
  ...overrides,
  instanceId: overrides.instanceId ?? storeId,
});

afterEach(cleanup);

describe("seventh semantic review remediations", () => {
  test("renders exhaustive memory-only and unknown synchronization health", () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const view = render(<NusmDevtoolsPanel devtoolsOpen theme="dark" />);
    sendSnapshot(
      target,
      snapshot("memory-only", { synchronization: "not_applicable" }),
    );
    expect(view.getAllByLabelText("Memory-only store").length).toBeGreaterThan(
      0,
    );
    expect(view.queryByText("Ready and synchronized")).not.toBeInTheDocument();

    sendSnapshot(
      target,
      snapshot("legacy-adapter", {
        adapterName: "custom-adapter",
        persisted: {},
      }),
    );
    expect(
      view.getAllByLabelText("Synchronization unknown").length,
    ).toBeGreaterThan(0);
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });

  test("reports the exact root data-key count beyond inspector safety limits", () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const value = Object.fromEntries(
      Array.from({ length: 5_000 }, (_, index) => [`key-${index}`, index]),
    );
    const view = render(<NusmDevtoolsPanel devtoolsOpen theme="dark" />);
    sendSnapshot(
      target,
      snapshot("large-store", {
        adapterName: "localStorage",
        memory: value,
        persisted: value,
        synchronization: "synchronized",
      }),
    );
    fireEvent.click(view.getByRole("button", { name: /large-store/i }));
    expect(view.getByText(/5,?000 memory keys/)).toBeInTheDocument();
    expect(view.queryByText(/2,?001 memory keys/)).not.toBeInTheDocument();
    (() => {
      cleanup();
      globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
    })();
  });
});
