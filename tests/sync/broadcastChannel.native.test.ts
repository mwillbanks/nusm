import { afterEach, describe, expect, test } from "bun:test";
import { Worker } from "node:worker_threads";
import {
  createHmacKey,
  eventToEnvelope,
  signEnvelope,
  verifyEnvelope,
} from "../../src/sync/protocol.js";
import { workerBundle } from "./fixtures/native-broadcast-worker.mjs";

const channels: BroadcastChannel[] = [];
const workers: Worker[] = [];
const keyBytes = new Uint8Array(
  Array.from({ length: 32 }, (_, index) => index + 1),
);

afterEach(() => {
  for (const channel of channels.splice(0)) channel.close();
  for (const worker of workers.splice(0)) void worker.terminate();
});

describe("native BroadcastChannel protocol bundles", () => {
  test("loads the independent worker bundle", () => {
    expect(workerBundle).toBe(true);
  });
  test("independently loaded worker-like channels exchange authenticated state", async () => {
    const key = await createHmacKey(keyBytes);
    const name = `nusm-native-${crypto.randomUUID()}`;
    const sender = new BroadcastChannel(name);
    const receiver = new BroadcastChannel(name);
    channels.push(sender, receiver);
    const envelope = await signEnvelope(
      key,
      eventToEnvelope(
        {
          eventId: "native-update",
          kind: "update",
          sourceId: "worker-a",
          state: { value: 42 },
          storeId: "native",
        },
        "worker-a",
        "worker-a:native-update",
        {
          maxChangedKeys: 128,
          maxEnvelopeBytes: 512 * 1024,
          maxIdentifierBytes: 128,
          maxIdentitiesPerPeer: 128,
          maxPeers: 32,
          maxProtocolErrors: 5,
          maxStateBytes: 256 * 1024,
          protocolErrorWindowMs: 10_000,
          quarantineAfter: 20,
          quarantineMs: 30_000,
        },
      ),
    );
    const received = new Promise<boolean>((resolve) => {
      receiver.onmessage = async ({ data }) =>
        resolve(await verifyEnvelope(key, data as typeof envelope));
    });
    sender.postMessage(envelope);
    expect(await received).toBe(true);
  });

  test("independent worker bundles exchange native BroadcastChannel messages", async () => {
    const name = `nusm-worker-${crypto.randomUUID()}`;
    const main = new BroadcastChannel(name);
    channels.push(main);
    const workerUrls = [
      "native-broadcast-worker.mjs",
      "native-broadcast-worker.mjs",
    ];
    const ready = workerUrls.map(
      (file, index) =>
        new Promise<void>((resolve, reject) => {
          const worker = new Worker(
            new URL(`./fixtures/${file}`, import.meta.url),
            {
              type: "module",
              workerData: { id: index, name },
            },
          );
          workers.push(worker);
          worker.once("error", reject);
          worker.once("message", (message) => {
            if (message?.kind === "ready") resolve();
          });
        }),
    );
    await Promise.all(ready);
    const replies = new Promise<Set<number>>((resolve) => {
      const values = new Set<number>();
      main.onmessage = ({ data }) => {
        if (data?.kind !== "reply") return;
        values.add(data.worker);
        if (values.size === 2) resolve(values);
      };
    });
    main.postMessage({ kind: "probe", value: 42 });
    expect(await replies).toEqual(new Set([0, 1]));
  });
});
