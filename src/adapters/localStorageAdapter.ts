import type { NusmAdapter, StorageAdapterOptions } from "../types";
import { createStorageAdapter } from "./storageAdapter";

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
