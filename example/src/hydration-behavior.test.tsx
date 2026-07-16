import "fake-indexeddb/auto";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { NusmAdapter } from "nusm";
import { createNusmStore } from "nusm";
import { App, observeStoreReadiness } from "./App";

afterEach(cleanup);

describe("example hydration and optional plugin truthfulness", () => {
  test("routes a real adapter hydration failure to the degraded callback", async () => {
    const adapter: NusmAdapter = {
      getItem: () => {
        throw new Error("IndexedDB unavailable");
      },
      name: "throwing-indexeddb",
      pacer: false,
      removeItem: () => undefined,
      setItem: () => undefined,
    };
    const store = createNusmStore(
      { value: 1 },
      { adapter, persist: { strategy: "entire" }, storeId: "broken-example" },
    );
    await store.ready;
    let ready = false;
    let failed = false;
    observeStoreReadiness(
      store,
      () => {
        ready = true;
      },
      () => {
        failed = true;
      },
    );
    expect(ready).toBe(false);
    expect(failed).toBe(true);
    expect(store.hydration.overall).toBe("error");
  });

  test("does not claim a live devtools connection in the production no-op state", () => {
    const view = render(<App />);
    expect(view.queryByText("Devtools live")).not.toBeInTheDocument();
    expect(view.getByText("Devtools dormant")).toBeInTheDocument();
    expect(view.getAllByText(/\?devtools/).length).toBeGreaterThan(0);
    expect(view.queryByText(/event bridge connected/)).not.toBeInTheDocument();
  });
});
