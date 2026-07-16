import "fake-indexeddb/auto";
import { describe, expect, test } from "bun:test";
import {
  createIndexDbAdapter,
  createLocalStorageAdapter,
  createNusmStore,
  createSessionStorageAdapter,
} from "nusm";

const createLifecycle = () => ({
  activity: createNusmStore(
    { events: [] as Array<{ id: string }> },
    {
      adapter: createIndexDbAdapter({
        dbName: "nusm-showcase-reload",
        pacer: false,
        storeName: "activity",
      }),
      persist: { strategy: "entire" },
      storeId: "reload-activity",
    },
  ),
  preferences: createNusmStore(
    { accent: "violet" },
    {
      adapter: createLocalStorageAdapter({ pacer: false }),
      persist: { strategy: "entire" },
      storeId: "reload-preferences",
    },
  ),
  session: createNusmStore(
    { drafts: 0 },
    {
      adapter: createSessionStorageAdapter({ pacer: false }),
      persist: { strategy: "entire" },
      storeId: "reload-session",
    },
  ),
});

describe("example persistence reload", () => {
  test("rehydrates changed localStorage, sessionStorage, and IndexedDB values in a second lifecycle", async () => {
    localStorage.removeItem("nusm:reload-preferences:entire");
    sessionStorage.removeItem("nusm:reload-session:entire");
    indexedDB.deleteDatabase("nusm-showcase-reload");

    const first = createLifecycle();
    await Promise.all([
      first.activity.ready,
      first.preferences.ready,
      first.session.ready,
    ]);
    first.preferences.setState({ accent: "electric" });
    first.session.setState({ drafts: 9 });
    first.activity.setState({ events: [{ id: "persisted-event" }] });
    await new Promise((resolve) => setTimeout(resolve, 25));

    const second = createLifecycle();
    await Promise.all([
      second.activity.ready,
      second.preferences.ready,
      second.session.ready,
    ]);

    expect(second.preferences.state).toEqual({ accent: "electric" });
    expect(second.session.state).toEqual({ drafts: 9 });
    expect(second.activity.state).toEqual({
      events: [{ id: "persisted-event" }],
    });
  });
});
