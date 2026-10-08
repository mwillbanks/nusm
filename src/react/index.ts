import { deepEqual, shallowEqual } from "fast-equals";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";

import type { NusmStore } from "../types.js";

export type NoInfer<T> = [T][T extends unknown ? 0 : never];

export interface UseStoreOptions {
  equal?: boolean;
}

export function useStore<TState, TSelected = NoInfer<TState>>(
  store: NusmStore<TState>,
  selector?: (state: NoInfer<TState>) => TSelected,
  options?: UseStoreOptions,
): TSelected;

export function useStore<TState, TSelected = NoInfer<TState>>(
  store: NusmStore<TState>,
  selector?: (state: NoInfer<TState>) => TSelected,
  options?: UseStoreOptions,
): TSelected;
export function useStore<TState, TSelected = NoInfer<TState>>(
  store: NusmStore<TState>,
  selector: (state: NoInfer<TState>) => TSelected = (d) => d as TSelected,
  options: UseStoreOptions = {},
): TSelected {
  const equal = options.equal ? deepEqual : shallowEqual;
  const getSnapshot = () => store.state;
  return useSyncExternalStoreWithSelector(
    (notify) => {
      const subscription = store.subscribe(notify);
      return typeof subscription === "function"
        ? subscription
        : subscription.unsubscribe;
    },
    getSnapshot,
    getSnapshot,
    selector,
    equal,
  );
}
