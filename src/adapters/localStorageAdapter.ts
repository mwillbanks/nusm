import type { NusmAdapter, StorageAdapterOptions } from "../types.js";
import { createStorageAdapter } from "./storageAdapter.js";

export const createLocalStorageAdapter = (
  options?: StorageAdapterOptions,
): NusmAdapter =>
  createStorageAdapter(
    "localStorage",
    typeof window === "undefined" ? undefined : window.localStorage,
    {
      pacer: { trailing: true, wait: 50 },
      ...options,
    },
  );
