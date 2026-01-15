import { describe, expect, test } from "bun:test";
import { createNusmDevtoolsEmitter } from "../../src/devtools/client";

describe("devtools client", () => {
  test("returns null when disabled", () => {
    expect(createNusmDevtoolsEmitter(false)).toBeNull();
  });

  test("emits queued events once connected", () => {
    const target = new EventTarget();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;

    const events: string[] = [];
    target.addEventListener("tanstack-dispatch-event", (event) => {
      const detail = (event as CustomEvent).detail as { type: string };
      events.push(detail.type);
    });

    const emitter = createNusmDevtoolsEmitter(true);
    if (!emitter) throw new Error("Missing emitter");

    emitter.emitSnapshot({
      hydration: { byKey: { entire: "hydrated" }, overall: "hydrated" },
      isReady: true,
      memory: { count: 1 },
      storeId: "store",
    });

    target.dispatchEvent(new CustomEvent("tanstack-connect-success"));

    expect(events.some((type) => type.includes("nusm:snapshot"))).toBe(true);
  });
});
