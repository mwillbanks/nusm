import type { NusmAdapter, StorageAdapterOptions } from "../types.js";
import { createStorageAdapter } from "./storageAdapter.js";

export const createSessionStorageAdapter = (
  options?: StorageAdapterOptions,
): NusmAdapter =>
  createStorageAdapter(
    "sessionStorage",
    typeof window === "undefined" ? undefined : window.sessionStorage,
    {
      pacer: { trailing: true, wait: 50 },
      ...options,
    },
  );
