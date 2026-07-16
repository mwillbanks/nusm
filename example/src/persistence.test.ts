import "fake-indexeddb/auto";
import { describe, expect, test } from "bun:test";
import {
  createIndexDbAdapter,
  createLocalStorageAdapter,
  createSessionStorageAdapter,
} from "nusm";
import {
  activityStore,
  preferencesStore,
  sessionStore,
  storesReady,
} from "./stores";

describe("example adapter persistence", () => {
  test("persists independent local, session, and IndexedDB interactions", async () => {
    await storesReady;
    preferencesStore.setState((state) => ({ ...state, accent: "electric" }));
    sessionStore.setState((state) => ({ ...state, drafts: state.drafts + 1 }));
    activityStore.setState((state) => ({
      ...state,
      events: [
        {
          id: "persistence-proof",
          label: "IndexedDB persistence verified",
          time: "now",
          tone: "green",
        },
        ...state.events,
      ],
    }));
    await new Promise((resolve) => setTimeout(resolve, 180));

    const local = createLocalStorageAdapter({ pacer: false });
    const session = createSessionStorageAdapter({ pacer: false });
    const indexed = createIndexDbAdapter({
      dbName: "nusm-showcase",
      pacer: false,
      storeName: "activity",
    });
    expect(await local.getItem("nusm:preferences:entire")).toMatchObject({
      accent: "electric",
    });
    expect(await session.getItem("nusm:live-session:entire")).toMatchObject({
      drafts: sessionStore.state.drafts,
    });
    expect(
      (
        (await indexed.getItem("nusm:activity-archive:entire")) as {
          events: Array<{ id: string }>;
        }
      ).events[0],
    ).toMatchObject({ id: "persistence-proof" });
  });
});
