/// <reference types="react" />
import type { Derived } from "@tanstack/store";
import { deepEqual, shallowEqual } from "fast-equals";
import { useRef, useSyncExternalStore } from "react";
import type { NusmStore } from "../types";

export type NoInfer<T> = [T][T extends unknown ? 0 : never];

interface UseStoreOptions {
  equal?: boolean;
}

export function useStore<TState, TSelected = NoInfer<TState>>(
  store: NusmStore<TState>,
  selector?: (state: NoInfer<TState>) => TSelected,
  options?: UseStoreOptions,
): TSelected;
export function useStore<TState, TSelected = NoInfer<TState>>(
  store: Derived<TState>,
  selector?: (state: NoInfer<TState>) => TSelected,
  options?: UseStoreOptions,
): TSelected;
export function useStore<TState, TSelected = NoInfer<TState>>(
  store: NusmStore<TState>,
  selector?: (state: NoInfer<TState>) => TSelected,
  options?: UseStoreOptions,
): TSelected;
export function useStore<TState, TSelected = NoInfer<TState>>(
  store: NusmStore<TState> | Derived<TState>,
  selector: (state: NoInfer<TState>) => TSelected = (d) => d as TSelected,
  options: UseStoreOptions = {},
): TSelected {
  const equal = options.equal ? deepEqual : shallowEqual;
  const getSnapshot = () => store.state;
  const snapshot = useSyncExternalStore(
    store.subscribe,
    getSnapshot,
    getSnapshot,
  );
  const selected = selector(snapshot as NoInfer<TState>);
  const selectedRef = useRef<TSelected>(selected);

  if (!equal(selectedRef.current, selected)) {
    selectedRef.current = selected;
  }

  return selectedRef.current;
}
