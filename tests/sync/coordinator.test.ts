import { describe, expect, test } from "bun:test";
import { configureNusm, createNusmStore } from "../../src/index.js";
import { createNusmSyncCoordinator } from "../../src/sync/coordinator.js";
import type {
  NusmSyncContext,
  NusmSyncSource,
  NusmSyncStatus,
} from "../../src/sync/types.js";

const source = (): NusmSyncSource => ({
  publish: () => undefined,
  start: () => undefined,
});
const validateSyncCandidate = (candidate: unknown, context: NusmSyncContext) =>
  context.source.length > 0 &&
  typeof candidate === "object" &&
  candidate !== null;

describe("synchronization coordinator", () => {
  test("uses Web Crypto random bytes for a coordinator identity fallback", async () => {
    const randomUuid = crypto.randomUUID;
    const randomValues = crypto.getRandomValues;
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(crypto, "getRandomValues", {
      configurable: true,
      value: <T extends ArrayBufferView | null>(array: T) => {
        if (array instanceof Uint8Array) array.fill(5);
        return array;
      },
    });
    try {
      const coordinator = createNusmSyncCoordinator({
        onEvent: () => undefined,
        storeId: "identity-fallback",
      });
      expect(coordinator.nextRevision().senderId).toBe(
        "05050505050505050505050505050505",
      );
      await coordinator.dispose();
    } finally {
      Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: randomUuid,
      });
      Object.defineProperty(crypto, "getRandomValues", {
        configurable: true,
        value: randomValues,
      });
    }
  });

  test("falls back to a process identity when Web Crypto is unavailable", async () => {
    const randomUuid = crypto.randomUUID;
    const randomValues = crypto.getRandomValues;
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(crypto, "getRandomValues", {
      configurable: true,
      value: undefined,
    });
    try {
      const coordinator = createNusmSyncCoordinator({
        onEvent: () => undefined,
        storeId: "identity-process-fallback",
      });
      expect(coordinator.nextRevision().senderId).toMatch(/^nusm-sync-/);
      await coordinator.dispose();
    } finally {
      Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: randomUuid,
      });
      Object.defineProperty(crypto, "getRandomValues", {
        configurable: true,
        value: randomValues,
      });
    }
  });

  test("auto-enables a configured source for identified stores", async () => {
    let starts = 0;
    const published: unknown[] = [];
    const configured: NusmSyncSource = {
      publish: (event) => published.push(event.state),
      start: () => {
        starts += 1;
      },
    };
    configureNusm({
      sync: { source: configured, validator: validateSyncCandidate },
    });
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

  test("bounds rejected candidates and isolates rejection observers", async () => {
    let rejections = 0;
    const coordinator = createNusmSyncCoordinator({
      onError: () => undefined,
      onEvent: () => undefined,
      onRejected: () => {
        rejections += 1;
        throw new Error("observer failed");
      },
      storeId: "bounded-rejections",
      validator: () => false,
    });
    await Promise.all(
      Array.from({ length: 260 }, (_, index) =>
        coordinator.enqueue({
          eventId: `reject-${index}`,
          kind: "update",
          revision: { counter: index + 1, senderId: "peer" },
          sourceId: "peer",
          state: { value: index },
          storeId: "bounded-rejections",
        }),
      ),
    );
    expect(rejections).toBe(260);
    await coordinator.dispose();
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

  test("contains source publish failures", async () => {
    const errors: unknown[] = [];
    const coordinator = createNusmSyncCoordinator({
      onError: (error) => errors.push(error),
      onEvent: () => undefined,
      sources: {
        publish: () => {
          throw new Error("publish failed");
        },
        start: () => undefined,
      },
      storeId: "publish-failure",
    });
    await coordinator.start();
    await coordinator.announceReady({ value: 0 });
    await coordinator.publish({
      eventId: "publish-failure",
      kind: "update",
      sourceId: "local",
      state: { value: 1 },
      storeId: "publish-failure",
    });
    expect(errors).toContainEqual(new Error("publish failed"));
    await coordinator.dispose();
  });

  test("exercises the public coordinator lifecycle matrix", async () => {
    const published: string[] = [];
    const received: string[] = [];
    let notify:
      | ((event: Parameters<NonNullable<NusmSyncSource["start"]>>[0]) => void)
      | undefined;
    let cleanupCalls = 0;
    const coordinator = createNusmSyncCoordinator({
      onEvent: (event) => {
        received.push(event.kind);
      },
      sources: {
        publish: (event) => {
          published.push(event.kind);
        },
        start: (listener) => {
          notify = listener;
          return () => {
            cleanupCalls += 1;
          };
        },
      },
      storeId: "coordinator-matrix",
    });
    expect(coordinator.status).toBe("pending");
    await coordinator.start();
    await coordinator.start();
    expect(coordinator.status).toBe("active");
    await coordinator.announceHydrating({ value: 0 });
    await coordinator.announceReady({ value: 0 });
    notify?.({
      eventId: "matrix-inbound",
      kind: "update",
      sourceId: "peer",
      state: { value: 1 },
      storeId: "coordinator-matrix",
    });
    await Promise.resolve();
    await coordinator.publish({
      eventId: "matrix-publish",
      kind: "update",
      sourceId: "local",
      state: { value: 2 },
      storeId: "coordinator-matrix",
    });
    await coordinator.enqueue({
      eventId: "matrix-enqueue",
      kind: "update",
      sourceId: "peer",
      state: { value: 3 },
      storeId: "coordinator-matrix",
    });
    await coordinator.enqueueAdapterEvent({ key: "state", type: "set" });
    const release = coordinator.recordPendingWrite("state", { value: 3 }, 1);
    expect(coordinator.hasPendingWrites()).toBe(true);
    expect(coordinator.isPendingWrite("state")).toBe(true);
    release();
    expect(coordinator.matchesPendingWrite("state", { value: 3 }, 1)).toBe(
      true,
    );
    expect(coordinator.isPendingWrite("state")).toBe(false);
    expect(coordinator.isConverged()).toBe(false);
    expect(coordinator.nextRevision().counter).toBeGreaterThan(0);
    await coordinator.dispose();
    await coordinator.dispose();
    expect(cleanupCalls).toBe(1);
    expect(published).toContain("ready");
    expect(received).toEqual(expect.arrayContaining(["update", "adapter"]));

    const pending = createNusmSyncCoordinator({
      onEvent: () => undefined,
      sources: source(),
      storeId: "coordinator-pending-matrix",
    });
    const pendingWait = pending.waitForConvergence();
    await pending.dispose();
    await pendingWait;

    const immediate = createNusmSyncCoordinator({
      onEvent: () => undefined,
      storeId: "coordinator-immediate-matrix",
    });
    expect(immediate.isConverged()).toBe(true);
    await immediate.waitForConvergence();
    await immediate.dispose();
  });

  test("records a served snapshot revision before convergence", async () => {
    let localId = "";
    const coordinator = createNusmSyncCoordinator({
      onEvent: () => undefined,
      onSnapshotRequest: () => ({ value: 2 }),
      sources: {
        publish: async (event) => {
          if (event.kind === "ready" && event.sourceId)
            localId = event.sourceId;
        },
        start: () => undefined,
      },
      storeId: "served-before-convergence",
    });
    await coordinator.start();
    await coordinator.announceReady({ value: 1 });
    await coordinator.enqueue({
      creationTime: Date.now() + 100_000,
      eventId: "later-peer",
      hydration: "ready",
      kind: "ready",
      sourceId: "later-peer",
      state: { value: 0 },
      storeId: "served-before-convergence",
    });
    await coordinator.enqueue({
      eventId: "snapshot-request",
      kind: "request",
      requestId: "snapshot-request",
      sourceId: "later-peer",
      storeId: "served-before-convergence",
      targetId: localId,
    });
    await coordinator.dispose();
  });

  test("adopts a served snapshot revision while convergence is pending", async () => {
    const originalNow = Date.now;
    let now = 1_000;
    Object.defineProperty(Date, "now", {
      configurable: true,
      value: () => now,
    });
    let localId = "";
    let servedSnapshots = 0;
    try {
      const coordinator = createNusmSyncCoordinator({
        onEvent: () => undefined,
        onSnapshotRequest: () => ({ value: 2 }),
        sources: {
          publish: (event) => {
            if (event.kind === "ready" && event.hydration === "ready")
              localId = event.sourceId;
            if (event.kind === "snapshot") servedSnapshots += 1;
          },
          start: () => undefined,
        },
        storeId: "served-pending",
      });
      await coordinator.start();
      await coordinator.enqueueAdapterEvent({ key: "state", type: "set" }, 1);
      await coordinator.announceReady({ value: 1 });
      await coordinator.enqueue({
        creationTime: 0,
        eventId: "pending-peer",
        hydration: "hydrating",
        kind: "ready",
        sourceId: "peer",
        state: { value: 0 },
        storeId: "served-pending",
      });
      expect(coordinator.isConverged()).toBe(false);
      now = 7_000;
      await coordinator.enqueue({
        eventId: "pending-request",
        kind: "request",
        requestId: "pending-request",
        sourceId: "peer",
        storeId: "served-pending",
        targetId: localId,
      });
      expect(servedSnapshots).toBe(1);
      expect(coordinator.nextRevision().counter).toBe(2);
      await coordinator.dispose();
    } finally {
      Object.defineProperty(Date, "now", {
        configurable: true,
        value: originalNow,
      });
    }
  });

  test("refreshes a hydrating announcement through its heartbeat", async () => {
    let heartbeats = 0;
    const coordinator = createNusmSyncCoordinator({
      onEvent: () => undefined,
      sources: {
        publish: (event) => {
          if (event.kind === "ready" && event.hydration === "hydrating")
            heartbeats += 1;
        },
        start: () => undefined,
      },
      storeId: "heartbeat-direct",
    });
    await coordinator.start();
    await coordinator.announceHydrating({ value: 1 });
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    expect(heartbeats).toBeGreaterThanOrEqual(2);
    await coordinator.dispose();
  });

  test("reports replay observer failures and rebases queued revisions", async () => {
    const errors: unknown[] = [];
    const published: unknown[] = [];
    const coordinator = createNusmSyncCoordinator({
      onError: (error) => errors.push(error),
      onEvent: (event) => {
        if (event.sourceId === "local") throw new Error("replay failed");
      },
      sources: {
        publish: (event) => published.push(event),
        start: () => undefined,
      },
      storeId: "replay",
    });
    await coordinator.start();
    await coordinator.publish({
      eventId: "queued-one",
      kind: "update",
      sourceId: "local",
      state: { value: 1 },
      storeId: "replay",
    });
    await coordinator.publish({
      eventId: "queued-two",
      kind: "update",
      sourceId: "local",
      state: { value: 2 },
      storeId: "replay",
    });
    await coordinator.enqueue({
      eventId: "peer-update",
      kind: "update",
      revision: { counter: 1, senderId: "peer" },
      sourceId: "peer",
      state: { value: 3 },
      storeId: "replay",
    });
    await coordinator.announceReady({ value: 0 });
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(errors).toContainEqual(new Error("replay failed"));
    expect(
      published.filter(
        (event) => (event as { kind?: string }).kind === "update",
      ),
    ).toHaveLength(2);
    await coordinator.dispose();
  });

  test("rebases queued revisions after an interleaved served request", async () => {
    let injected = false;
    const remoteRevisions: number[] = [];
    const eventOrder: string[] = [];
    const updates: Array<{ counter?: number }> = [];
    let coordinator: ReturnType<typeof createNusmSyncCoordinator> | undefined;
    const recordPeerUpdate = (event: { revision?: { counter?: number } }) => {
      const counter = event.revision?.counter ?? 0;
      remoteRevisions.push(counter);
      eventOrder.push(`peer-${counter}`);
    };
    const queueInterleavedPeers = () => {
      const firstRemote = coordinator?.enqueue({
        eventId: "interleaved-remote-one",
        kind: "update",
        revision: { counter: 1, senderId: "peer" },
        sourceId: "peer",
        state: { value: 100 },
        storeId: "rebase",
      });
      return firstRemote?.then(() =>
        coordinator?.enqueue({
          eventId: "interleaved-remote-two",
          kind: "update",
          revision: { counter: 2, senderId: "peer" },
          sourceId: "peer",
          state: { value: 101 },
          storeId: "rebase",
        }),
      );
    };
    const handleRebaseEvent = (event: {
      kind: string;
      sourceId: string;
      revision?: { counter?: number };
    }) => {
      if (event.kind !== "update") return;
      if (event.sourceId === "peer") {
        recordPeerUpdate(event);
        return;
      }
      if (event.sourceId !== "local") return;
      eventOrder.push(`local-${event.revision?.counter ?? 0}`);
      if (injected) return;
      injected = true;
      return queueInterleavedPeers();
    };
    coordinator = createNusmSyncCoordinator({
      onEvent: handleRebaseEvent,
      onSnapshotRequest: () => ({ value: 0 }),
      sources: {
        publish: async (event) => {
          if (event.kind === "update") updates.push(event.revision ?? {});
        },
        start: () => undefined,
      },
      storeId: "rebase",
    });
    await coordinator.start();
    await coordinator.announceReady({ value: 0 });
    await coordinator.enqueue({
      creationTime: 0,
      eventId: "peer-hydrating",
      hydration: "hydrating",
      kind: "ready",
      sourceId: "peer",
      state: { value: 0 },
      storeId: "rebase",
    });
    await coordinator.publish({
      eventId: "queued-one",
      kind: "update",
      sourceId: "local",
      state: { value: 1 },
      storeId: "rebase",
    });
    await coordinator.publish({
      eventId: "queued-two",
      kind: "update",
      sourceId: "local",
      state: { value: 2 },
      storeId: "rebase",
    });
    await coordinator.enqueue({
      creationTime: Date.now() + 100_000,
      eventId: "peer-ready",
      hydration: "ready",
      kind: "ready",
      sourceId: "peer",
      storeId: "rebase",
    });
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(updates).toHaveLength(2);
    expect(injected).toBe(true);
    expect(remoteRevisions).toEqual([1, 2]);
    expect(eventOrder).toEqual(["local-1", "peer-1", "peer-2", "local-3"]);
    await coordinator.dispose();
  });

  test("runs cleanup returned after disposal and reports cleanup failures", async () => {
    const errors: unknown[] = [];
    let releaseStart!: () => void;
    const started = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const coordinator = createNusmSyncCoordinator({
      onError: (error) => errors.push(error),
      onEvent: () => undefined,
      sources: {
        publish: () => undefined,
        start: async () => {
          await started;
          return () => {
            throw new Error("late cleanup failed");
          };
        },
      },
      storeId: "late-cleanup",
    });
    const startPromise = coordinator.start();
    await Promise.resolve();
    await coordinator.dispose();
    releaseStart();
    await startPromise;
    expect(errors).toContainEqual(new Error("late cleanup failed"));
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
