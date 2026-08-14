import { describe, expect, test } from "bun:test";
import { configureNusm, createNusmStore } from "../../src/index.js";
import { createNusmSyncCoordinator } from "../../src/sync/coordinator.js";
import type { NusmSyncSource, NusmSyncStatus } from "../../src/sync/types.js";

const source = (): NusmSyncSource => ({
  publish: () => undefined,
  start: () => undefined,
});

describe("synchronization coordinator", () => {
  test("auto-enables a configured source for identified stores", async () => {
    let starts = 0;
    const published: unknown[] = [];
    const configured: NusmSyncSource = {
      publish: (event) => published.push(event.state),
      start: () => {
        starts += 1;
      },
    };
    configureNusm({ sync: { source: configured } });
    const enabled = createNusmStore({ value: 0 }, { storeId: "global-source" });
    const disabled = createNusmStore(
      { value: 0 },
      { storeId: "opted-out", sync: false },
    );
    await Promise.all([enabled.ready, disabled.ready]);
    enabled.setState({ value: 1 });
    await Promise.resolve();
    expect(starts).toBe(1);
    expect(published).toContainEqual({ value: 1 });
    await enabled.dispose();
    await disabled.dispose();
    configureNusm({});
  });

  test("serializes inbound events through one ordered consumer", async () => {
    const received: string[] = [];
    const coordinator = createNusmSyncCoordinator({
      onEvent: async (event) => {
        received.push(event.eventId);
        await Promise.resolve();
      },
      sources: source(),
      storeId: "ordered",
    });
    await coordinator.start();
    await Promise.all([
      coordinator.enqueue({
        eventId: "one",
        kind: "update",
        sourceId: "peer",
        state: { value: 1 },
        storeId: "ordered",
      }),
      coordinator.enqueue({
        eventId: "two",
        kind: "update",
        sourceId: "peer",
        state: { value: 2 },
        storeId: "ordered",
      }),
    ]);
    expect(received).toEqual(["one", "two"]);
    await coordinator.dispose();
  });

  test("drops duplicate source identities before the store consumer", async () => {
    const received: string[] = [];
    const coordinator = createNusmSyncCoordinator({
      onEvent: (event) => {
        received.push(event.eventId);
      },
      storeId: "dedup",
    });
    const event = {
      eventId: "same",
      kind: "update" as const,
      sourceId: "peer",
      state: { value: 1 },
      storeId: "dedup",
    };
    await coordinator.enqueue(event);
    await coordinator.enqueue({ ...event });
    expect(received).toEqual(["same"]);
  });

  test("correlates cloned values across overlapping generations", () => {
    const coordinator = createNusmSyncCoordinator({
      onEvent: () => undefined,
      storeId: "writes",
    });
    const releaseFirst = coordinator.recordPendingWrite(
      "state",
      { items: ["first"] },
      1,
    );
    const releaseSecond = coordinator.recordPendingWrite(
      "state",
      { items: ["second"] },
      2,
    );
    expect(coordinator.isPendingWrite("state")).toBe(true);
    releaseFirst();
    releaseSecond();
    expect(
      coordinator.matchesPendingWrite("state", { items: ["first"] }, 1),
    ).toBe(true);
    expect(
      coordinator.matchesPendingWrite("state", { items: ["second"] }, 2),
    ).toBe(true);
    expect(coordinator.matchesPendingWrite("state", { items: ["other"] })).toBe(
      false,
    );
  });

  test("keeps delayed old echoes distinct from a newer write", () => {
    const coordinator = createNusmSyncCoordinator({
      onEvent: () => undefined,
      storeId: "delayed",
    });
    const releaseOld = coordinator.recordPendingWrite("state", { value: 1 }, 4);
    const releaseNew = coordinator.recordPendingWrite("state", { value: 2 }, 5);
    releaseOld();
    releaseNew();
    expect(coordinator.matchesPendingWrite("state", { value: 1 }, 4)).toBe(
      true,
    );
    expect(coordinator.matchesPendingWrite("state", { value: 2 }, 5)).toBe(
      true,
    );
  });

  test("bounds pending history to recent write generations", () => {
    const coordinator = createNusmSyncCoordinator({
      onEvent: () => undefined,
      storeId: "bounded-writes",
    });
    const releases = Array.from({ length: 130 }, (_, index) =>
      coordinator.recordPendingWrite("state", { value: index }, index),
    );
    expect(coordinator.hasPendingWrites()).toBe(true);
    for (const release of releases) release();
    expect(coordinator.hasPendingWrites()).toBe(false);
    expect(coordinator.matchesPendingWrite("state", { value: 0 }, 0)).toBe(
      false,
    );
    expect(coordinator.matchesPendingWrite("state", { value: 129 }, 129)).toBe(
      true,
    );
    expect(coordinator.isPendingWrite("missing")).toBe(false);
  });

  test("isolates source and observer failures across lifecycle operations", async () => {
    const reported: unknown[] = [];
    const statuses: NusmSyncStatus[] = [];
    let cleanupCalls = 0;
    const failingStart: NusmSyncSource = {
      publish: () => undefined,
      start: () => {
        throw "source start failed";
      },
    };
    const failingSource: NusmSyncSource = {
      dispose: () => {
        throw new Error("source dispose failed");
      },
      publish: () => {
        throw { message: "source publish failed" };
      },
      start: () => () => {
        cleanupCalls += 1;
        throw new Error("source cleanup failed");
      },
    };
    const coordinator = createNusmSyncCoordinator({
      onError: (error) => {
        reported.push(error);
        if (reported.length === 1) throw new Error("error observer failed");
      },
      onEvent: () => undefined,
      onStatus: (status) => {
        statuses.push(status);
        if (status === "unavailable") throw new Error("status observer failed");
      },
      sources: [failingStart, failingSource],
      storeId: "failures",
    });

    await coordinator.start();
    expect(coordinator.status).toBe("unavailable");
    await coordinator.publish({
      eventId: "publish-failure",
      kind: "update",
      sourceId: "local",
      state: { value: 1 },
      storeId: "failures",
    });
    await expect(coordinator.dispose()).rejects.toBeInstanceOf(AggregateError);
    expect(cleanupCalls).toBe(1);
    expect(statuses).toEqual(["unavailable", "disposed"]);
    expect(reported.length).toBeGreaterThanOrEqual(4);
  });

  test("does not pre-poison identities from another store and evicts old identities", async () => {
    const received: string[] = [];
    const coordinator = createNusmSyncCoordinator({
      onEvent: (event) => {
        received.push(event.eventId);
      },
      storeId: "identity-safe",
    });
    const event = (eventId: string, storeId = "identity-safe") => ({
      eventId,
      kind: "update" as const,
      sourceId: "peer",
      state: { value: eventId },
      storeId,
    });

    await coordinator.enqueue(event("shared", "other-store"));
    await coordinator.enqueue(event("shared"));
    await Promise.all(
      Array.from({ length: 257 }, (_, index) =>
        coordinator.enqueue(event(`event-${index}`)),
      ),
    );
    await coordinator.enqueue(event("event-0"));

    expect(received[0]).toBe("shared");
    expect(received.at(-1)).toBe("event-0");
    expect(received).toHaveLength(259);
  });
});
