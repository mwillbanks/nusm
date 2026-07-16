import "fake-indexeddb/auto";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  createIndexDbAdapter,
  createLocalStorageAdapter,
  createSessionStorageAdapter,
} from "nusm";
import { App } from "./App";
import { storesReady } from "./stores";

afterEach(cleanup);

describe("runtime-remediated example", () => {
  test("shows controlled Command, Stores, and Signals views with nusm identity", async () => {
    await storesReady;
    const view = render(<App />);

    expect(
      view.getByRole("img", { name: "nusm example logo" }),
    ).toHaveAttribute("viewBox", "0 0 148 78");
    expect(
      view.getByRole("region", { name: "Command center view" }),
    ).toBeVisible();
    expect(view.queryByRole("region", { name: "Stores view" })).toBeNull();
    expect(view.queryByRole("region", { name: "Signals view" })).toBeNull();

    fireEvent.click(view.getByRole("button", { name: /Stores/ }));
    expect(view.getByRole("region", { name: "Stores view" })).toBeVisible();
    expect(
      view.queryByRole("region", { name: "Command center view" }),
    ).toBeNull();
    expect(view.queryByRole("region", { name: "Signals view" })).toBeNull();

    fireEvent.click(view.getByRole("button", { name: /Signals/ }));
    expect(view.getByRole("region", { name: "Signals view" })).toBeVisible();
    expect(
      view.queryByRole("region", { name: "Command center view" }),
    ).toBeNull();
    expect(view.queryByRole("region", { name: "Stores view" })).toBeNull();

    fireEvent.click(view.getByRole("button", { name: /Command center/ }));
    expect(
      view.getByRole("region", { name: "Command center view" }),
    ).toBeVisible();
    expect(view.queryByRole("region", { name: "Stores view" })).toBeNull();
    expect(view.queryByRole("region", { name: "Signals view" })).toBeNull();
  });

  test("has real initial values in every configured browser adapter", async () => {
    await storesReady;
    const local = createLocalStorageAdapter({ pacer: false });
    const session = createSessionStorageAdapter({ pacer: false });
    const indexed = createIndexDbAdapter({
      dbName: "nusm-showcase",
      pacer: false,
      storeName: "activity",
    });

    expect(await local.getItem("nusm:preferences:entire")).not.toBeNull();
    expect(await session.getItem("nusm:live-session:entire")).not.toBeNull();
    expect(
      await indexed.getItem("nusm:activity-archive:entire"),
    ).not.toBeNull();
  });
});
