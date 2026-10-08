import { afterEach, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { FakeBroadcastChannel } from "./tests/helpers/fake-broadcast-channel";

const matchers = await (async () => {
  if (typeof document === "undefined") GlobalRegistrator.register();
  return import("@testing-library/jest-dom/matchers");
})();
const { cleanup } = await import("@testing-library/react");

const browserTarget = window as unknown as { BroadcastChannel?: unknown };
browserTarget.BroadcastChannel ??= FakeBroadcastChannel;

expect.extend(matchers);

afterEach(() => {
  cleanup();
  FakeBroadcastChannel.reset();
});
