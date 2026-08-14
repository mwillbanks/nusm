import { describe, expect, test } from "bun:test";
import {
  createHmacKey,
  DEFAULT_BROADCAST_LIMITS,
  envelopeToEvent,
  eventToEnvelope,
} from "../../src/sync/protocol.js";

describe("synchronization wire protocol", () => {
  test("rejects invalid CryptoKey inputs at the protocol boundary", async () => {
    const aes = await crypto.subtle.generateKey(
      { length: 256, name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    await expect(createHmacKey(aes as CryptoKey)).rejects.toThrow(
      "HMAC-SHA-256",
    );
  });

  test("round-trips optional state, revisions, and control metadata", () => {
    const envelope = eventToEnvelope(
      {
        causalRevision: { counter: 2, epoch: "3", senderId: "peer" },
        changedKeys: ["profile"],
        creationTime: 42,
        eventId: "event",
        generation: 7,
        hydration: "ready",
        key: "state",
        kind: "snapshot",
        requestId: "request",
        revision: { counter: 4, epoch: "3", senderId: "peer" },
        sourceId: "peer",
        state: { value: 1 },
        storeId: "store",
        targetId: "target",
      },
      "sender",
      "sender:event",
      DEFAULT_BROADCAST_LIMITS,
    );
    expect(envelopeToEvent(envelope)).toMatchObject({
      causalRevision: { counter: 2, epoch: "3", senderId: "peer" },
      changedKeys: ["profile"],
      creationTime: 42,
      generation: 7,
      hydration: "ready",
      key: "state",
      requestId: "request",
      revision: { counter: 4, epoch: "3", senderId: "peer" },
      state: { value: 1 },
      targetId: "target",
    });
  });

  test("enforces the inbound state size limit", () => {
    const envelope = eventToEnvelope(
      {
        eventId: "oversized",
        kind: "update",
        sourceId: "peer",
        state: { value: "large" },
        storeId: "store",
      },
      "sender",
      "sender:oversized",
      DEFAULT_BROADCAST_LIMITS,
    );
    expect(() =>
      envelopeToEvent(envelope, {
        ...DEFAULT_BROADCAST_LIMITS,
        maxStateBytes: 1,
      }),
    ).toThrow("Synchronized state exceeds");
  });
});
