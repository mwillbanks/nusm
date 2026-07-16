import { describe, expect, test } from "bun:test";
import { createNusmDevtoolsEmitter } from "../../src/devtools/client";

describe("devtools client", () => {
  test("returns null when disabled", () => {
    expect(createNusmDevtoolsEmitter(false)).toBeNull();
  });

  test("emits queued events once connected", () => {
    const target = new EventTarget();
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    globalThis.__TANSTACK_EVENT_TARGET__ = target;

    const events: string[] = [];
    target.addEventListener("tanstack-dispatch-event", (event) => {
      const detail = (event as CustomEvent).detail as { type: string };
      events.push(detail.type);
    });

    const emitter = createNusmDevtoolsEmitter(true);
    if (!emitter) throw new Error("Missing emitter");
    emitter.emitCommand({
      action: "refresh",
      commandId: "refresh-1",
      instanceId: "nusm-legacy-client",
      storeId: "store",
    });
    emitter.emitEvent({ storeId: "store", ts: 1, type: "persist_flush_ok" });
    emitter.emitHydration("store", {
      byKey: { entire: "hydrated" },
      overall: "hydrated",
    });
    emitter.emitSnapshot({
      hydration: { byKey: { entire: "hydrated" }, overall: "hydrated" },
      initial: { count: 0 },
      isReady: true,
      memory: { count: 1 },
      storeId: "store",
    });
    target.dispatchEvent(new CustomEvent("tanstack-connect-success"));

    expect(events.some((type) => type.includes("nusm:snapshot"))).toBe(true);
    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
  });

  test("keeps a client bound to its captured event target", () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const capturedTarget = new EventTarget();
    const replacementTarget = new EventTarget();
    const capturedEvents: string[] = [];
    const replacementEvents: string[] = [];
    capturedTarget.addEventListener("tanstack-connect", () => {
      capturedTarget.dispatchEvent(new CustomEvent("tanstack-connect-success"));
    });
    capturedTarget.addEventListener("tanstack-dispatch-event", (event) => {
      capturedEvents.push((event as CustomEvent<{ type: string }>).detail.type);
    });
    replacementTarget.addEventListener("tanstack-dispatch-event", (event) => {
      replacementEvents.push(
        (event as CustomEvent<{ type: string }>).detail.type,
      );
    });
    globalThis.__TANSTACK_EVENT_TARGET__ = capturedTarget;
    const emitter = createNusmDevtoolsEmitter(true);
    if (!emitter) throw new Error("Missing emitter");

    globalThis.__TANSTACK_EVENT_TARGET__ = replacementTarget;
    emitter.emitSnapshot({
      hydration: { byKey: {}, overall: "hydrated" },
      isReady: true,
      memory: { count: 1 },
      storeId: "captured",
    });

    expect(capturedEvents).toContain("nusm:snapshot");
    expect(replacementEvents).toEqual([]);
    expect(globalThis.__TANSTACK_EVENT_TARGET__).toBe(replacementTarget);
    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
  });
});
