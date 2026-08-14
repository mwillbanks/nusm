import { describe, expect, test } from "bun:test";
import { createRuntimeSyncKey } from "./sync-key";

describe("runtime synchronization key delivery", () => {
  test("keeps production delivery disabled by default", () => {
    expect(createRuntimeSyncKey({ NODE_ENV: "production" })).toBeUndefined();
  });

  test("creates a process runtime key when explicitly enabled", () => {
    const encoded = createRuntimeSyncKey({
      NODE_ENV: "production",
      NUSM_ENABLE_SYNC: "1",
    });
    expect(encoded).toBeString();
    expect(
      Buffer.from(encoded ?? "", "base64").byteLength,
    ).toBeGreaterThanOrEqual(32);
  });

  test("canonicalizes an authorized configured key", () => {
    const configured = Buffer.from(new Uint8Array(32).fill(7)).toString(
      "base64",
    );
    expect(
      createRuntimeSyncKey({
        NODE_ENV: "production",
        NUSM_ENABLE_SYNC: "1",
        NUSM_SYNC_KEY: configured,
      }),
    ).toBe(configured);
  });

  test("rejects configured keys shorter than the protocol minimum", () => {
    expect(() =>
      createRuntimeSyncKey({
        NODE_ENV: "production",
        NUSM_ENABLE_SYNC: "1",
        NUSM_SYNC_KEY: Buffer.from(new Uint8Array(31)).toString("base64"),
      }),
    ).toThrow("at least 32 bytes");
  });
});
