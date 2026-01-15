import { describe, expect, test } from "bun:test";
import { createNusmDevtoolsPlugin } from "../../src/devtools/plugin";

describe("devtools plugin", () => {
  test("renders and reacts to events", () => {
    const plugin = createNusmDevtoolsPlugin();
    const root = document.createElement("div");

    const cleanup = plugin.render(root, "light");

    window.dispatchEvent(
      new CustomEvent("nusm:snapshot", {
        detail: {
          payload: { memory: { count: 1 }, storeId: "store" },
        },
      }),
    );

    window.dispatchEvent(
      new CustomEvent("nusm:event", {
        detail: {
          payload: { storeId: "store", ts: 1, type: "persist_flush_ok" },
        },
      }),
    );

    expect(root.textContent).toContain("store");
    expect(root.textContent).toContain("persist_flush_ok");

    // @ts-expect-error - react cleanup, render will return void
    cleanup();
  });
});
