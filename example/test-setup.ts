import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
await import("fake-indexeddb/auto");
const { cleanup } = await import("@testing-library/react");
await import("@testing-library/jest-dom");
afterEach(cleanup);
