export type LifecycleCleanup = () => void | Promise<void>;

export const runLifecycleCleanup = async (
  cleanups: readonly LifecycleCleanup[],
  flush: LifecycleCleanup,
  report: (error: unknown) => void,
): Promise<unknown[]> => {
  const failures: unknown[] = [];
  const collect = (error: unknown) => {
    const values = error instanceof AggregateError ? error.errors : [error];
    for (const failure of values) {
      failures.push(failure);
      report(failure);
    }
  };
  const runNext = async (index: number): Promise<void> => {
    if (index >= cleanups.length) return;
    const cleanup = cleanups[index];
    if (!cleanup) return;
    try {
      await cleanup();
    } catch (error) {
      collect(error);
    }
    try {
      await flush();
    } catch (error) {
      collect(error);
    }
    await runNext(index + 1);
  };
  await runNext(0);
  return failures;
};

/** Coordinates synchronous cancellation with one shared asynchronous disposal. */
export interface StoreLifecycle {
  readonly disposed: boolean;
  readonly generation: number;
  beginDispose(cleanup: LifecycleCleanup): Promise<void>;
  isCurrent(generation: number): boolean;
}

export const createStoreLifecycle = (): StoreLifecycle => {
  let disposed = false;
  let generation = 0;
  let disposal: Promise<void> | undefined;

  return {
    beginDispose(cleanup) {
      if (disposal) return disposal;
      disposed = true;
      generation += 1;
      // Defer cleanup until after the promise has been created. This keeps
      // dispose() synchronous for lifecycle guards while preventing sync throws.
      disposal = Promise.resolve().then(cleanup);
      return disposal;
    },
    get disposed() {
      return disposed;
    },
    get generation() {
      return generation;
    },
    isCurrent(candidate) {
      return !disposed && candidate === generation;
    },
  };
};
