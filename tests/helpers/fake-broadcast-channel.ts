type Listener = ((event: MessageEvent<unknown>) => void) | null;

export class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>();
  static messages: Array<{ message: unknown; name: string }> = [];

  static reset() {
    FakeBroadcastChannel.channels.clear();
    FakeBroadcastChannel.messages = [];
  }

  readonly name: string;
  // fallow-ignore-next-line unused-class-member -- exercised through the BroadcastChannel structural contract.
  onmessage: Listener = null;

  constructor(name: string) {
    this.name = name;
    const channels = FakeBroadcastChannel.channels.get(name) ?? new Set();
    channels.add(this);
    FakeBroadcastChannel.channels.set(name, channels);
  }

  // fallow-ignore-next-line unused-class-member -- exercised through the BroadcastChannel structural contract.
  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }

  // fallow-ignore-next-line unused-class-member -- exercised through the BroadcastChannel structural contract.
  postMessage(message: unknown) {
    const cloned = structuredClone(message);
    FakeBroadcastChannel.messages.push({ message: cloned, name: this.name });
    for (const channel of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      queueMicrotask(() =>
        channel.onmessage?.({ data: cloned } as MessageEvent),
      );
    }
  }

  static postRaw(name: string, data: unknown) {
    for (const channel of FakeBroadcastChannel.channels.get(name) ?? []) {
      queueMicrotask(() => channel.onmessage?.({ data } as MessageEvent));
    }
  }
}

export const installFakeBroadcastChannel = () => {
  const target = window as unknown as { BroadcastChannel?: unknown };
  const original = target.BroadcastChannel;
  target.BroadcastChannel = FakeBroadcastChannel;
  return () => {
    if (original === undefined) delete target.BroadcastChannel;
    else target.BroadcastChannel = original;
    FakeBroadcastChannel.reset();
  };
};
