import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type {
  AdapterEvent,
  NusmAdapter,
  NusmDevtoolsSnapshot,
} from "../../src";
import { createNusmStore } from "../../src";
import { NusmDevtoolsPanel } from "../../src/devtools/panel";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const relay = () => {
  const target = new EventTarget();
  target.addEventListener("tanstack-connect", () =>
    target.dispatchEvent(new CustomEvent("tanstack-connect-success")),
  );
  target.addEventListener("tanstack-dispatch-event", (event) => {
    const detail = (event as CustomEvent<{ type: string; payload: unknown }>)
      .detail;
    target.dispatchEvent(new CustomEvent(detail.type, { detail }));
  });
  return target;
};

const dispatchCommand = async (
  target: EventTarget,
  payload: Record<string, unknown>,
) =>
  act(async () => {
    target.dispatchEvent(
      new CustomEvent("nusm:command", { detail: { payload } }),
    );
    await tick();
  });

afterEach(cleanup);

describe("instance identity and scoped adapter events", () => {
  test("keeps duplicate display ids independently visible and targets exactly one store", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const snapshots: NusmDevtoolsSnapshot[] = [];
    const results: Array<{ instanceId: string }> = [];
    target.addEventListener("nusm:snapshot", (event) =>
      snapshots.push((event as CustomEvent).detail.payload),
    );
    target.addEventListener("nusm:commandResult", (event) =>
      results.push((event as CustomEvent).detail.payload),
    );
    const first = createNusmStore(
      { value: "first" },
      { devtools: true, storeId: "same" },
    );
    const second = createNusmStore(
      { value: "second" },
      { devtools: true, storeId: "same" },
    );
    await Promise.all([first.ready, second.ready]);

    const view = render(<NusmDevtoolsPanel theme="dark" />);
    await waitFor(() =>
      expect(
        view.getAllByRole("button", { name: /same memory only/i }),
      ).toHaveLength(2),
    );
    expect(first.devtoolsInstanceId).not.toBe(second.devtoolsInstanceId);
    expect(
      new Set(
        snapshots
          .filter(({ storeId }) => storeId === "same")
          .map(({ instanceId }) => instanceId),
      ).size,
    ).toBe(2);

    await dispatchCommand(target, {
      action: "replace_memory",
      commandId: "target-first-only",
      instanceId: first.devtoolsInstanceId,
      storeId: "same",
      value: { value: "changed" },
    });
    await tick();

    expect(first.state).toEqual({ value: "changed" });
    expect(second.state).toEqual({ value: "second" });
    expect(
      results.filter(
        (result) => result.instanceId === first.devtoolsInstanceId,
      ),
    ).toContainEqual(
      expect.objectContaining({ instanceId: first.devtoolsInstanceId }),
    );
    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
  });

  test("normalizes unusable and colliding names into commandable unique instances", async () => {
    const originalTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const snapshots: NusmDevtoolsSnapshot[] = [];
    target.addEventListener("nusm:snapshot", (event) =>
      snapshots.push((event as CustomEvent).detail.payload),
    );
    const emoji = createNusmStore(
      { value: "emoji" },
      { devtools: { name: "💥" } },
    );
    const left = createNusmStore(
      { value: "left" },
      { devtools: { name: "A!" } },
    );
    const right = createNusmStore(
      { value: "right" },
      { devtools: { name: "A?" } },
    );
    await Promise.all([emoji.ready, left.ready, right.ready]);
    await tick();

    const emojiSnapshot = snapshots.find(
      ({ instanceId }) => instanceId === emoji.devtoolsInstanceId,
    );
    expect(emojiSnapshot?.storeId).toBe(emoji.devtoolsInstanceId);
    expect(emojiSnapshot?.storeId).not.toBe("");
    expect(left.devtoolsInstanceId).not.toBe(right.devtoolsInstanceId);
    expect(
      snapshots
        .filter(({ storeId }) => storeId === "a")
        .map(({ instanceId }) => instanceId),
    ).toEqual(
      expect.arrayContaining([
        left.devtoolsInstanceId,
        right.devtoolsInstanceId,
      ]),
    );

    await dispatchCommand(target, {
      action: "replace_memory",
      commandId: "normalized-collision-target",
      instanceId: right.devtoolsInstanceId,
      storeId: "a",
      value: { value: "targeted" },
    });
    await tick();
    expect(left.state).toEqual({ value: "left" });
    expect(right.state).toEqual({ value: "targeted" });
    globalThis.__TANSTACK_EVENT_TARGET__ = originalTarget;
  });

  test("resets configured slices on clear without destroying live non-persisted state", async () => {
    type State = { ephemeral: string; persisted: number };
    const listeners = new Set<(event: AdapterEvent) => void>();
    const values = new Map<string, unknown>([
      ["nusm:slice-clear-scope:slice:persisted", 2],
    ]);
    const adapter: NusmAdapter = {
      getItem: (key) => values.get(key) ?? null,
      name: "clear-scope",
      pacer: false,
      removeItem: (key) => {
        values.delete(key);
      },
      setItem: (key, value) => {
        values.set(key, value);
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const store = createNusmStore<State>(
      { ephemeral: "initial", persisted: 1 },
      {
        adapter,
        persist: {
          slices: [
            {
              apply: (state, value) => ({
                ...state,
                persisted: value as number,
              }),
              key: "persisted",
              select: (state) => state.persisted,
            },
          ],
          strategy: "slices",
        },
        storeId: "slice-clear-scope",
      },
    );
    await store.ready;
    store.setState((state) => ({ ...state, ephemeral: "keep-me" }));
    for (const listener of listeners) listener({ type: "clear" });
    await tick();

    expect(store.state).toEqual({ ephemeral: "keep-me", persisted: 1 });
  });
});
