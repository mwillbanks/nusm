const MINIMUM_KEY_BYTES = 32;
type RuntimeEnvironment = {
  NODE_ENV?: string;
  NUSM_ENABLE_SYNC?: string;
  NUSM_SYNC_KEY?: string;
};

const decodeConfiguredKey = (encoded: string): Uint8Array => {
  const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
  if (bytes.byteLength < MINIMUM_KEY_BYTES)
    throw new Error("NUSM_SYNC_KEY must decode to at least 32 bytes.");
  return bytes;
};

/** Returns one process-scoped key only when synchronization is enabled. */
export const createRuntimeSyncKey = (
  environment: RuntimeEnvironment = Bun.env,
): string | undefined => {
  const enabled =
    environment.NODE_ENV !== "production" ||
    environment.NUSM_ENABLE_SYNC === "1";
  if (!enabled) return undefined;
  if (environment.NUSM_SYNC_KEY) {
    const bytes = decodeConfiguredKey(environment.NUSM_SYNC_KEY);
    return Buffer.from(bytes).toString("base64");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(MINIMUM_KEY_BYTES));
  return Buffer.from(bytes).toString("base64");
};
