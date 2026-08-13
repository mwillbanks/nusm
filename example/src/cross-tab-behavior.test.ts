import "fake-indexeddb/auto";
import { afterEach, describe, expect, test } from "bun:test";
import {
  createIndexDbAdapter,
  createLocalStorageAdapter,
  createNusmStore,
  createSessionStorageAdapter,
  type NusmAdapter,
} from "nusm";

class ExampleBroadcastChannel {
  static channels = new Map<string, Set<ExampleBroadcastChannel>>();
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

  constructor(readonly name: string) {
    const channels = ExampleBroadcastChannel.channels.get(name) ?? new Set();
    channels.add(this);
    ExampleBroadcastChannel.channels.set(name, channels);
  }

  close() {
    ExampleBroadcastChannel.channels.get(this.name)?.delete(this);
  }

  postMessage(message: unknown) {
    const value = structuredClone(message);
    for (const channel of ExampleBroadcastChannel.channels.get(this.name) ?? [])
      queueMicrotask(() =>
        channel.onmessage?.({ data: value } as MessageEvent),
      );
  }
}

const browserTarget = window as unknown as { BroadcastChannel?: unknown };
const originalBroadcastChannel = browserTarget.BroadcastChannel;
browserTarget.BroadcastChannel = ExampleBroadcastChannel;

afterEach(() => ExampleBroadcastChannel.channels.clear());

const verifyAdapter = async (
  name: string,
  createAdapter?: () => NusmAdapter,
) => {
  const storeId = `example-${name}`;
  const first = createNusmStore(
    { value: 0 },
    { adapter: createAdapter?.(), crossTab: true, storeId },
  );
  const second = createNusmStore(
    { value: 0 },
    { adapter: createAdapter?.(), crossTab: true, storeId },
  );
  await Promise.all([first.ready, second.ready]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  first.setState((state) => ({ value: state.value + 1 }));
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(second.state).toEqual({ value: 1 });
  await Promise.all([first.dispose(), second.dispose()]);
};

describe("example cross-tab behavior", () => {
  test("synchronizes memory and every built-in browser adapter", async () => {
    localStorage.clear();
    sessionStorage.clear();
    await verifyAdapter("memory");
    await verifyAdapter("local", () => createLocalStorageAdapter());
    await verifyAdapter("session", () => createSessionStorageAdapter());
    await verifyAdapter("indexed", () =>
      createIndexDbAdapter({ dbName: "nusm-cross-tab-example" }),
    );
  });
});

afterEach(() => {
  browserTarget.BroadcastChannel = originalBroadcastChannel;
});
