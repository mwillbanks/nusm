import { afterEach, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const matchers = await (async () => {
  typeof document === "undefined" && GlobalRegistrator.register();
  return import("@testing-library/jest-dom/matchers");
})();
const { cleanup } = await import("@testing-library/react");

typeof document === "undefined" && GlobalRegistrator.register();

expect.extend(matchers);

afterEach(() => {
  cleanup();
});
