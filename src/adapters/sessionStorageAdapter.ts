import type { NusmAdapter, StorageAdapterOptions } from "../types";
import { createStorageAdapter } from "./storageAdapter";

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
