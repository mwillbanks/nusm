import { afterEach, expect } from "bun:test";
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
await import("fake-indexeddb/auto");
const { cleanup } = await import("@testing-library/react");
const { default: _default, ...matchers } =
  await import("@testing-library/jest-dom/matchers");

declare module "bun:test" {
  interface Matchers<T> extends TestingLibraryMatchers<T, void> {}
}

expect.extend(matchers);
afterEach(cleanup);
