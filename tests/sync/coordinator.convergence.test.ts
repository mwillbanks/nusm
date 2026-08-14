import { afterEach, describe, expect, test } from "bun:test";
import { configureNusm, createNusmStore } from "../../src/index.js";
import { createNusmSyncCoordinator } from "../../src/sync/coordinator.js";
import type { NusmSyncContext, NusmSyncEvent } from "../../src/sync/types.js";

type TestEvent = NusmSyncEvent<unknown>;
type PublishedEvent = { from: string; event: TestEvent };
const validateSyncCandidate = (candidate: unknown, context: NusmSyncContext) =>
  context.source.length > 0 &&
  typeof candidate === "object" &&
  candidate !== null;

const updatesFrom = (published: PublishedEvent[], from: string) =>
  published.filter(
    ({ from: source, event }) => source === from && event.kind === "update",
  );
const revisionCounter = (event: TestEvent) => event.revision?.counter ?? 0;
const stateValue = (entry: PublishedEvent) =>
  (entry.event.state as { value: number }).value;

const createBus = () => {
  const listeners = new Map<string, Set<(event: TestEvent) => void>>();
  const published: Array<{ from: string; event: TestEvent }> = [];
  const drops: Array<(from: string, event: TestEvent) => boolean> = [];
  const transforms = new Map<string, (event: TestEvent) => TestEvent>();
  const reverseFor = new Set<string>();
  const source = (id: string) => ({
    publish(event: TestEvent) {
      const outbound = transforms.get(id)?.(event) ?? event;
      published.push({ event: outbound, from: id });
      const dropIndex = drops.findIndex((drop) => drop(id, outbound));
      if (dropIndex >= 0) {
        drops.splice(dropIndex, 1);
        return;
      }
      for (const entries of listeners.values()) {
        const ordered = reverseFor.has(id)
          ? [...entries].reverse()
          : [...entries];
        for (const listener of ordered)
          queueMicrotask(() => listener(outbound));
      }
    },
    sourceId: id,
    start(listener: (event: TestEvent) => void) {
      const entries = listeners.get(id) ?? new Set();
      entries.add(listener);
      listeners.set(id, entries);
      return () => entries.delete(listener);
    },
  });
  return {
    drop: (predicate: (from: string, event: TestEvent) => boolean) =>
      drops.push(predicate),
    published,
    reverse: (id: string) => reverseFor.add(id),
    source,
    transform: (id: string, transform: (event: TestEvent) => TestEvent) =>
      transforms.set(id, transform),
  };
};

const adapter = (value: number, delay = 0) => ({
  async getItem() {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    return { value };
  },
  removeItem: async () => undefined,
  setItem: async () => undefined,
});

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const createManualSource = () => {
  let listener: ((event: TestEvent) => void) | undefined;
  const published: TestEvent[] = [];
  return {
    emit(event: TestEvent) {
      listener?.(event);
    },
    published,
    source: {
      publish(event: TestEvent) {
        published.push(event);
      },
      sourceId: "manual",
      start(next: (event: TestEvent) => void) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    },
  };
};

afterEach(() => configureNusm({}));

describe("synchronization coordinator convergence", () => {
  test("earlier hydrating authority wins over a newer ready peer", async () => {
    const bus = createBus();
    const leader = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(9, 30),
        persist: { strategy: "entire" },
        storeId: "authority",
        sync: {
          source: bus.source("leader"),
          validator: validateSyncCandidate,
        },
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 2));
    const follower = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(2),
        persist: { strategy: "entire" },
        storeId: "authority",
        sync: {
          source: bus.source("follower"),
          validator: validateSyncCandidate,
        },
      },
    );
    await Promise.all([leader.ready, follower.ready]);
    expect(leader.state).toEqual({ value: 9 });
    expect(follower.state).toEqual({ value: 9 });
    await leader.dispose();
    await follower.dispose();
  });

  test("hydration heartbeat preserves authority beyond the discovery cycle", async () => {
    const bus = createBus();
    const leader = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(42, 4200),
        persist: { strategy: "entire" },
        storeId: "heartbeat-authority",
        sync: {
          source: bus.source("heartbeat-leader"),
          validator: validateSyncCandidate,
        },
      },
    );
    await wait(10);
    const follower = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(0),
        persist: { strategy: "entire" },
        storeId: "heartbeat-authority",
        sync: {
          source: bus.source("heartbeat-follower"),
          validator: validateSyncCandidate,
        },
      },
    );
    await Promise.all([leader.ready, follower.ready]);
    await wait(25);
    expect(
      bus.published.filter(({ event }) => event.hydration === "hydrating")
        .length,
    ).toBeGreaterThanOrEqual(4);
    expect(leader.state).toEqual({ value: 42 });
    expect(follower.state).toEqual({ value: 42 });
    await leader.dispose();
    await follower.dispose();
  }, 10_000);

  test("late hydration announcements reacquire an existing ready leader", async () => {
    const bus = createBus();
    const leader = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(42),
        persist: { strategy: "entire" },
        storeId: "late-join",
        sync: {
          source: bus.source("late-leader"),
          validator: validateSyncCandidate,
        },
      },
    );
    await leader.ready;
    await wait(20);
    const follower = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(0),
        persist: { strategy: "entire" },
        storeId: "late-join",
        sync: {
          source: bus.source("late-follower"),
          validator: validateSyncCandidate,
        },
      },
    );
    await follower.ready;
    expect(follower.state).toEqual({ value: 42 });
    await leader.dispose();
    await follower.dispose();
  });

  test("concurrent valid updates converge by sender identity", async () => {
    const bus = createBus();
    bus.reverse("left");
    const left = createNusmStore(
      { value: 0 },
      {
        storeId: "concurrent",
        sync: { source: bus.source("left"), validator: validateSyncCandidate },
      },
    );
    const right = createNusmStore(
      { value: 0 },
      {
        storeId: "concurrent",
        sync: { source: bus.source("right"), validator: validateSyncCandidate },
      },
    );
    await Promise.all([left.ready, right.ready]);
    left.setState({ value: 1 });
    right.setState({ value: 2 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(left.state).toEqual(right.state);
    await left.dispose();
    await right.dispose();
  });

  test("uses distinct synchronization identities for matching Devtools sequences", async () => {
    const bus = createBus();
    const left = createNusmStore(
      { value: 0 },
      {
        storeId: "identity-collision",
        sync: {
          source: bus.source("identity-left"),
          validator: validateSyncCandidate,
        },
      },
    );
    const right = createNusmStore(
      { value: 0 },
      {
        storeId: "identity-collision",
        sync: {
          source: bus.source("identity-right"),
          validator: validateSyncCandidate,
        },
      },
    );
    await Promise.all([left.ready, right.ready]);
    left.setState({ value: 1 });
    right.setState({ value: 2 });
    await wait(20);
    const updates = bus.published.filter(
      ({ event }) => event.kind === "update",
    );
    expect(
      new Set(updates.map(({ event }) => event.sourceId)).size,
    ).toBeGreaterThanOrEqual(2);
    expect(
      updates.filter(({ from }) => from === "identity-left"),
    ).not.toHaveLength(0);
    expect(
      updates.filter(({ from }) => from === "identity-right"),
    ).not.toHaveLength(0);
    expect(
      updates
        .filter(({ from }) => from === "identity-left")
        .every(({ event }) => event.sourceId !== left.devtoolsInstanceId),
    ).toBe(true);
    expect(
      updates
        .filter(({ from }) => from === "identity-right")
        .every(({ event }) => event.sourceId !== right.devtoolsInstanceId),
    ).toBe(true);
    expect(left.state).toEqual(right.state);
    await left.dispose();
    await right.dispose();
  });

  test("retries a lost request and snapshot", async () => {
    const bus = createBus();
    bus.drop((_from, event) => event.kind === "request");
    bus.drop((_from, event) => event.kind === "snapshot");
    const leader = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(42, 20),
        persist: { strategy: "entire" },
        storeId: "retry-request-snapshot",
        sync: {
          source: bus.source("leader"),
          validator: validateSyncCandidate,
        },
      },
    );
    await wait(2);
    const follower = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(0),
        persist: { strategy: "entire" },
        storeId: "retry-request-snapshot",
        sync: {
          source: bus.source("follower"),
          validator: validateSyncCandidate,
        },
      },
    );
    await Promise.all([leader.ready, follower.ready]);
    expect(follower.state).toEqual({ value: 42 });
    expect(
      bus.published.filter(({ event }) => event.kind === "request"),
    ).toHaveLength(3);
    expect(
      bus.published.filter(({ event }) => event.kind === "snapshot"),
    ).toHaveLength(2);
    await leader.dispose();
    await follower.dispose();
  });

  test("rejected snapshots retry without acknowledgement or duplicate application", async () => {
    const bus = createBus();
    bus.drop((_from, event) => event.kind === "snapshot");
    const target = new EventTarget();
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    target.addEventListener("tanstack-connect", () =>
      target.dispatchEvent(new CustomEvent("tanstack-connect-success")),
    );
    let rejectionEvents = 0;
    target.addEventListener("tanstack-dispatch-event", (event) => {
      const detail = (event as CustomEvent).detail as {
        type?: string;
        payload?: { type?: string };
      };
      if (
        detail.type === "nusm:event" &&
        detail.payload?.type === "synchronization_rejected"
      )
        rejectionEvents += 1;
    });
    const leader = createNusmStore(
      { value: 42 },
      {
        adapter: adapter(42),
        persist: { strategy: "entire" },
        storeId: "rejected-snapshot",
        sync: {
          source: bus.source("rejected-leader"),
          validator: validateSyncCandidate,
        },
      },
    );
    await leader.ready;
    const errors: unknown[] = [];
    const follower = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(0),
        devtools: true,
        onError: (error) => errors.push(error),
        persist: { strategy: "entire" },
        storeId: "rejected-snapshot",
        sync: {
          optimistic: true,
          source: bus.source("rejected-follower"),
          validator: () => false,
        },
      },
    );
    await follower.ready;
    await wait(800);
    expect(follower.state).toEqual({ value: 0 });
    expect(
      bus.published.filter(({ event }) => event.kind === "snapshot").length,
    ).toBeGreaterThanOrEqual(2);
    const servedSnapshotRequestIds = new Set(
      bus.published
        .filter(
          ({ from, event }) =>
            from === "rejected-leader" &&
            event.kind === "snapshot" &&
            event.requestId,
        )
        .map(({ event }) => event.requestId),
    );
    expect(
      bus.published.filter(
        ({ from, event }) =>
          from === "rejected-follower" &&
          event.kind === "ack" &&
          event.requestId &&
          servedSnapshotRequestIds.has(event.requestId),
      ),
    ).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(rejectionEvents).toBe(1);
    await leader.dispose();
    await follower.dispose();
    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
  });

  test("retransmits a snapshot after the first acknowledgement is lost", async () => {
    const bus = createBus();
    let dropped = false;
    bus.drop((from, event) => {
      if (dropped || event.kind !== "ack" || from !== "leader-ack")
        return false;
      dropped = true;
      return true;
    });
    const leader = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(42, 20),
        persist: { strategy: "entire" },
        storeId: "retry-ack",
        sync: {
          source: bus.source("leader-ack"),
          validator: validateSyncCandidate,
        },
      },
    );
    await wait(2);
    const follower = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(0),
        persist: { strategy: "entire" },
        storeId: "retry-ack",
        sync: {
          source: bus.source("follower-ack"),
          validator: validateSyncCandidate,
        },
      },
    );
    await Promise.all([leader.ready, follower.ready]);
    expect(follower.state).toEqual({ value: 42 });
    expect(
      bus.published.filter(({ event }) => event.kind === "snapshot").length,
    ).toBeGreaterThanOrEqual(2);
    await leader.dispose();
    await follower.dispose();
  });

  test("strict readiness waits for a bounded discovery cycle", async () => {
    const bus = createBus();
    const startedAt = Date.now();
    const store = createNusmStore(
      { value: 1 },
      {
        storeId: "strict-discovery",
        sync: {
          source: bus.source("isolated"),
          validator: validateSyncCandidate,
        },
      },
    );
    let settled = false;
    void store.ready.then(() => {
      settled = true;
    });
    await wait(20);
    expect(settled).toBe(false);
    expect(store.isReady).toBe(false);
    await store.ready;
    expect(store.isReady).toBe(true);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(70);
    await store.dispose();
  });

  test("optimistic readiness queues local changes until convergence", async () => {
    const bus = createBus();
    const leader = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(42, 30),
        persist: { strategy: "entire" },
        storeId: "optimistic",
        sync: {
          source: bus.source("optimistic-leader"),
          validator: validateSyncCandidate,
        },
      },
    );
    await wait(2);
    const follower = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(0),
        persist: { strategy: "entire" },
        storeId: "optimistic",
        sync: {
          optimistic: true,
          source: bus.source("optimistic-follower"),
          validator: validateSyncCandidate,
        },
      },
    );
    await follower.ready;
    follower.setState({ value: 7 });
    expect(
      bus.published.some(
        ({ from, event }) =>
          from === "optimistic-follower" && event.kind === "update",
      ),
    ).toBe(false);
    await leader.ready;
    await wait(20);
    expect(follower.state).toEqual({ value: 7 });
    expect(leader.state).toEqual({ value: 7 });
    expect(
      bus.published.some(
        ({ from, event }) =>
          from === "optimistic-follower" && event.kind === "update",
      ),
    ).toBe(true);
    await leader.dispose();
    await follower.dispose();
  });

  test("strict hydration queues local updates until convergence", async () => {
    const bus = createBus();
    const store = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(0, 100),
        persist: { strategy: "entire" },
        storeId: "strict-queue",
        sync: {
          source: bus.source("strict-queue"),
          validator: validateSyncCandidate,
        },
      },
    );
    store.setState({ value: 1 });
    await wait(1);
    store.setState({ value: 2 });
    await wait(20);
    expect(
      bus.published.some(
        ({ from, event }) => from === "strict-queue" && event.kind === "update",
      ),
    ).toBe(false);
    await store.ready;
    await wait(20);
    const updates = bus.published.filter(
      ({ from, event }) => from === "strict-queue" && event.kind === "update",
    );
    expect(
      updates.map(({ event }) => (event.state as { value: number }).value),
    ).toEqual([1, 2]);
    await store.dispose();
  });

  test("strict follower reapplies queued local state after leader snapshot", async () => {
    const bus = createBus();
    const leader = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(42, 80),
        persist: { strategy: "entire" },
        storeId: "strict-follower-queue",
        sync: {
          source: bus.source("strict-follower-leader"),
          validator: validateSyncCandidate,
        },
      },
    );
    await leader.ready;
    leader.setState({ value: 42 });
    await wait(5);
    const follower = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(0, 30),
        persist: { strategy: "entire" },
        storeId: "strict-follower-queue",
        sync: {
          source: bus.source("strict-follower-follower"),
          validator: validateSyncCandidate,
        },
      },
    );
    const observed: number[] = [];
    const stopObserving = follower.subscribe((state) => {
      observed.push((state as { value: number }).value);
    });
    follower.setState({ value: 7 });
    await Promise.all([leader.ready, follower.ready]);
    await wait(25);
    expect(follower.state).toEqual({ value: 7 });
    expect(leader.state).toEqual({ value: 7 });
    const snapshotIndex = observed.indexOf(42);
    const replayIndex = observed.lastIndexOf(7);
    expect(snapshotIndex).toBeGreaterThanOrEqual(0);
    expect(replayIndex).toBeGreaterThan(snapshotIndex);
    follower.setState({ value: 8 });
    await wait(100);
    expect(follower.state).toEqual({ value: 8 });
    stopObserving.unsubscribe();
    expect(leader.state).toEqual({ value: 8 });
    await leader.dispose();
    await follower.dispose();
  });

  test("queues callback updates until replay finishes", async () => {
    const bus = createBus();
    let leader:
      | ReturnType<typeof createNusmStore<{ value: number }>>
      | undefined;
    leader = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(42, 80),
        persist: { strategy: "entire" },
        storeId: "callback-replay-queue",
        sync: {
          source: bus.source("callback-replay-leader"),
          validator: validateSyncCandidate,
        },
      },
    );
    await leader.ready;
    leader.setState({ value: 42 });
    const followerSource = bus.source("callback-replay-follower");
    const publishFollowerEvent = followerSource.publish;
    followerSource.publish = (event) => {
      const result = publishFollowerEvent(event);
      if (
        event.kind === "update" &&
        stateValue({ event, from: "callback-replay-follower" }) === 7 &&
        leader
      )
        leader.setState({ value: 9 });
      return result;
    };
    const follower = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(0, 30),
        persist: { strategy: "entire" },
        storeId: "callback-replay-queue",
        sync: { source: followerSource, validator: validateSyncCandidate },
      },
    );
    let callbackUpdateSent = false;
    const stopObserving = follower.subscribe((state) => {
      if (!callbackUpdateSent && (state as { value: number }).value === 7) {
        callbackUpdateSent = true;
        follower.setState({ value: 8 });
      }
    });
    follower.setState({ value: 7 });
    await Promise.all([leader.ready, follower.ready]);
    await wait(100);
    expect(callbackUpdateSent).toBe(true);
    expect(follower.state).toEqual({ value: 8 });
    expect(leader.state).toEqual({ value: 8 });
    const updates = updatesFrom(bus.published, "callback-replay-follower");
    expect(updates.map((entry) => stateValue(entry))).toEqual([7, 8]);
    const revisions = updates.map(({ event }) => revisionCounter(event));
    expect(revisions[1]).toBe(revisions[0] + 1);
    const leaderUpdates = updatesFrom(bus.published, "callback-replay-leader");
    const remoteUpdate = leaderUpdates.find((entry) => stateValue(entry) === 9);
    if (!remoteUpdate?.event.revision)
      throw new Error("missing remote revision");
    expect(revisionCounter(updates[1].event)).toBeGreaterThan(
      revisionCounter(remoteUpdate.event),
    );
    stopObserving.unsubscribe();
    await leader.dispose();
    await follower.dispose();
  });

  test("bounds hydration queue without creating revision gaps", async () => {
    const bus = createBus();
    const store = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(0, 100),
        persist: { strategy: "entire" },
        storeId: "queue-overflow",
        sync: {
          source: bus.source("queue-overflow"),
          validator: validateSyncCandidate,
        },
      },
    );
    for (let value = 1; value <= 300; value += 1) store.setState({ value });
    await store.ready;
    await wait(25);
    const updates = updatesFrom(bus.published, "queue-overflow");
    expect(updates.length).toBe(256);
    const revisions = updates.map(({ event }) => revisionCounter(event));
    expect(
      revisions.every(
        (counter, index) => index === 0 || counter === revisions[index - 1] + 1,
      ),
    ).toBe(true);
    const latestUpdate = updates.at(-1);
    if (!latestUpdate) throw new Error("queue overflow produced no updates");
    expect(stateValue(latestUpdate)).toBe(300);
    const lastRevision = revisionCounter(latestUpdate.event);
    store.setState({ value: 301 });
    await wait(10);
    const finalUpdate = updatesFrom(bus.published, "queue-overflow").at(-1);
    expect(finalUpdate?.event.revision?.counter).toBe(lastRevision + 1);
    if (!finalUpdate) throw new Error("queue recovery produced no update");
    expect(stateValue(finalUpdate)).toBe(301);
    await bus.source("queue-overflow-remote").publish({
      eventId: "queue-overflow-remote-update",
      kind: "update",
      revision: {
        counter: revisionCounter(finalUpdate.event) + 1,
        epoch: "0",
        senderId: "queue-overflow-remote",
      },
      sourceId: "queue-overflow-remote",
      state: { value: 400 },
      storeId: "queue-overflow",
    });
    await wait(10);
    expect(store.state).toEqual({ value: 400 });
    store.setState({ value: 401 });
    await wait(10);
    const recoveryUpdate = updatesFrom(bus.published, "queue-overflow").at(-1);
    expect(recoveryUpdate?.event.revision?.counter).toBe(
      revisionCounter(finalUpdate.event) + 2,
    );
    await store.dispose();
  });

  test("ignores forged acknowledgements and wrong-target snapshots while pending", async () => {
    const bus = createBus();
    const leader = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(42, 100),
        persist: { strategy: "entire" },
        storeId: "forged-protocol",
        sync: {
          source: bus.source("forged-leader"),
          validator: validateSyncCandidate,
        },
      },
    );
    await wait(10);
    const follower = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(0),
        persist: { strategy: "entire" },
        storeId: "forged-protocol",
        sync: {
          source: bus.source("forged-follower"),
          validator: validateSyncCandidate,
        },
      },
    );
    const followerId = await (async () => {
      while (true) {
        const event = bus.published.find(
          ({ from, event }) =>
            from === "forged-follower" && event.hydration === "ready",
        );
        if (event) return event.event.sourceId as string;
        await wait(1);
      }
    })();
    let settled = false;
    void follower.ready.then(() => {
      settled = true;
    });
    const attacker = bus.source("forged-attacker");
    attacker.publish({
      eventId: "wrong-target-snapshot",
      kind: "snapshot",
      requestId: "unknown",
      revision: { counter: 1, epoch: "0", senderId: "forged-attacker" },
      sourceId: "forged-attacker",
      state: { value: 99 },
      storeId: "forged-protocol",
      targetId: followerId,
    });
    attacker.publish({
      eventId: "forged-ack",
      kind: "ack",
      requestId: "unknown",
      sourceId: "forged-attacker",
      storeId: "forged-protocol",
      targetId: followerId,
    });
    await wait(20);
    expect(settled).toBe(false);
    expect(follower.isReady).toBe(false);
    expect(follower.state).toEqual({ value: 0 });
    await Promise.all([leader.ready, follower.ready]);
    expect(follower.state).toEqual({ value: 42 });
    await leader.dispose();
    await follower.dispose();
  });

  test("rejects malformed, stale, replayed, skipped, and near-overflow revisions", async () => {
    const manual = createManualSource();
    const store = createNusmStore(
      { value: 0 },
      {
        storeId: "revision-poison",
        sync: { source: manual.source, validator: validateSyncCandidate },
      },
    );
    await store.ready;
    const emit = (
      eventId: string,
      counter: number,
      epoch = "0",
      senderId = "peer",
    ) =>
      manual.emit({
        eventId,
        kind: "update",
        revision: { counter, epoch, senderId },
        sourceId: senderId,
        state: { value: counter },
        storeId: "revision-poison",
      });
    emit("valid", 1);
    await wait(2);
    emit("unauthorized-epoch", 1, "4");
    emit("nonnumeric-epoch", 1, "NaN", "peer-nonnumeric");
    emit("first-high", 500, "0", "peer-high");
    for (const [eventId, counter] of [
      ["zero", 0],
      ["negative", -1],
      ["fractional", 1.5],
      ["safe", Number.MAX_SAFE_INTEGER],
      ["max31", 0x7fffffff],
      ["near", 0x7fffffff - 4095],
      ["excessive", 1_000_001],
      ["stale", 1],
      ["replay", 1],
      ["skipped", 3],
    ] as const)
      emit(eventId, counter);
    await wait(5);
    expect(store.state).toEqual({ value: 1 });
    manual.emit({
      eventId: "unsolicited-snapshot",
      kind: "snapshot",
      requestId: "unknown",
      revision: { counter: 1, epoch: "0", senderId: "attacker" },
      sourceId: "attacker",
      state: { value: 99 },
      storeId: "revision-poison",
      targetId: "manual",
    });
    manual.emit({
      eventId: "unsolicited-ack",
      kind: "ack",
      requestId: "unknown",
      sourceId: "attacker",
      storeId: "revision-poison",
      targetId: "manual",
    });
    await wait(2);
    expect(store.state).toEqual({ value: 1 });
    emit("recovered", 2);
    await wait(2);
    expect(store.state).toEqual({ value: 2 });
    await store.dispose();
  });

  test("bounds handshake metadata while preserving later updates", async () => {
    const manual = createManualSource();
    const store = createNusmStore(
      { value: 0 },
      {
        storeId: "metadata-flood",
        sync: { source: manual.source, validator: validateSyncCandidate },
      },
    );
    await store.ready;
    for (let index = 0; index < 64; index += 1)
      manual.emit({
        creationTime: index + 1,
        eventId: `ready-${index}`,
        hydration: "ready",
        kind: "ready",
        sourceId: `peer-${index}`,
        storeId: "metadata-flood",
      });
    for (let index = 0; index < 512; index += 1)
      manual.emit({
        eventId: `revision-${index}`,
        kind: "update",
        revision: { counter: 1, epoch: "0", senderId: `revision-${index}` },
        sourceId: `revision-${index}`,
        state: { value: index },
        storeId: "metadata-flood",
      });
    manual.emit({
      eventId: "post-flood",
      kind: "update",
      revision: { counter: 2, epoch: "0", senderId: "post-flood" },
      sourceId: "post-flood",
      state: { value: 64 },
      storeId: "metadata-flood",
    });
    await wait(5);
    expect(store.state).toEqual({ value: 64 });
    await store.dispose();
  });

  test("retries a snapshot after application failure without poisoning progression", async () => {
    const bus = createBus();
    let attempts = 0;
    let applied: unknown;
    let snapshotSenderId = "";
    let normalized: unknown;
    const leader = createNusmSyncCoordinator({
      onEvent: () => undefined,
      onSnapshotRequest: () => ({ value: 42 }),
      sources: bus.source("apply-leader"),
      storeId: "apply-retry",
    });
    await wait(5);
    const follower = createNusmSyncCoordinator({
      onEvent: async (event) => {
        if (event.kind !== "snapshot") {
          normalized = event.state;
          return;
        }
        attempts += 1;
        snapshotSenderId = event.revision?.senderId ?? snapshotSenderId;
        if (attempts === 1) throw new Error("transient apply failure");
        applied = event.state;
      },
      sources: bus.source("apply-follower"),
      storeId: "apply-retry",
    });
    await Promise.all([leader.start(), follower.start()]);
    await leader.announceHydrating({ value: 42 });
    await follower.announceHydrating({ value: 0 });
    await leader.announceReady({ value: 42 });
    await follower.announceReady({ value: 0 });
    await follower.waitForConvergence();
    await wait(100);
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(applied).toEqual({ value: 42 });
    await follower.enqueue({
      eventId: "normalized-after-snapshot",
      kind: "update",
      revision: { counter: 1, senderId: snapshotSenderId },
      sourceId: snapshotSenderId,
      state: { value: 43 },
      storeId: "apply-retry",
    });
    await wait(5);
    expect(normalized).toEqual({ value: 43 });
    await leader.dispose();
    await follower.dispose();
  });

  test("rejects stale snapshot epochs and recovers on the current epoch", async () => {
    const bus = createBus();
    let snapshots = 0;
    let applied: unknown;
    const leader = createNusmSyncCoordinator({
      onEvent: () => undefined,
      onSnapshotRequest: () => ({ value: 42 }),
      sources: bus.source("stale-leader"),
      storeId: "stale-snapshot",
    });
    await wait(5);
    const follower = createNusmSyncCoordinator({
      onEvent: (event) => {
        if (event.kind === "snapshot") applied = event.state;
      },
      sources: bus.source("stale-follower"),
      storeId: "stale-snapshot",
    });
    bus.transform("stale-leader", (event) => {
      if (event.kind !== "snapshot") return event;
      snapshots += 1;
      return {
        ...event,
        revision: { ...event.revision, epoch: snapshots === 1 ? "0" : "1" },
      };
    });
    await Promise.all([leader.start(), follower.start()]);
    await follower.enqueue({
      eventId: "seed-1",
      kind: "update",
      revision: { counter: 1, epoch: "0", senderId: "seed" },
      sourceId: "seed",
      state: { value: 1 },
      storeId: "stale-snapshot",
    });
    await follower.enqueue({
      eventId: "seed-2",
      kind: "update",
      revision: { counter: 1, epoch: "1", senderId: "seed" },
      sourceId: "seed",
      state: { value: 2 },
      storeId: "stale-snapshot",
    });
    await leader.announceHydrating({ value: 42 });
    await follower.announceHydrating({ value: 0 });
    await leader.announceReady({ value: 42 });
    await follower.announceReady({ value: 0 });
    await follower.waitForConvergence();
    expect(snapshots).toBeGreaterThanOrEqual(2);
    expect(applied).toEqual({ value: 42 });
    await leader.dispose();
    await follower.dispose();
  });

  test("tracks sender progression independently and rolls epochs without losing state", async () => {
    const manual = createManualSource();
    const store = createNusmStore(
      { value: 0 },
      {
        storeId: "revision-rollover",
        sync: { source: manual.source, validator: validateSyncCandidate },
      },
    );
    await store.ready;
    manual.emit({
      eventId: "a1",
      kind: "update",
      revision: { counter: 1, epoch: "0", senderId: "peer-a" },
      sourceId: "peer-a",
      state: { value: 1 },
      storeId: "revision-rollover",
    });
    manual.emit({
      eventId: "b1",
      kind: "update",
      revision: { counter: 1, epoch: "0", senderId: "peer-b" },
      sourceId: "peer-b",
      state: { value: 2 },
      storeId: "revision-rollover",
    });
    await wait(2);
    manual.emit({
      eventId: "a2",
      kind: "update",
      revision: { counter: 2, epoch: "0", senderId: "peer-a" },
      sourceId: "peer-a",
      state: { value: 3 },
      storeId: "revision-rollover",
    });
    await wait(2);
    expect(store.state).toEqual({ value: 3 });
    await store.dispose();

    const bus = createBus();
    bus.transform("rollover-leader", (event) =>
      event.kind === "snapshot"
        ? {
            ...event,
            revision: {
              ...event.revision,
              counter: 0x7fffffff - 4097,
            },
          }
        : event,
    );
    const leader = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(42, 10),
        persist: { strategy: "entire" },
        storeId: "revision-rollover-authorized",
        sync: {
          source: bus.source("rollover-leader"),
          validator: validateSyncCandidate,
        },
      },
    );
    await wait(2);
    const follower = createNusmStore(
      { value: 0 },
      {
        adapter: adapter(0),
        persist: { strategy: "entire" },
        storeId: "revision-rollover-authorized",
        sync: {
          source: bus.source("rollover-follower"),
          validator: validateSyncCandidate,
        },
      },
    );
    await Promise.all([leader.ready, follower.ready]);
    expect(follower.state).toEqual({ value: 42 });
    follower.setState({ value: 5 });
    await wait(2);
    const localUpdate = bus.published.find(
      ({ from, event }) =>
        from === "rollover-follower" && event.kind === "update",
    );
    expect(localUpdate?.event.revision?.epoch).not.toBe("0");
    await leader.dispose();
    await follower.dispose();
  });
});
