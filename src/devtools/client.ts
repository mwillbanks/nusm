import { EventClient } from "@tanstack/devtools-event-client/production";
import type {
  HydrationStatus,
  NusmDevtoolsSnapshot,
  NusmEvent,
} from "../types.js";
import type {
  NusmDevtoolsCommand,
  NusmDevtoolsCommandResult,
  NusmDevtoolsEventMap,
} from "./types.js";

const devtoolsClients = new WeakMap<
  object,
  {
    emit<TEvent extends keyof NusmDevtoolsEventMap & string>(
      eventSuffix: TEvent,
      payload: NusmDevtoolsEventMap[TEvent],
    ): void;
    on<TEvent extends keyof NusmDevtoolsEventMap & string>(
      eventSuffix: TEvent,
      callback: (event: { payload: NusmDevtoolsEventMap[TEvent] }) => void,
    ): () => void;
  }
>();

const getDevtoolsTarget = (): object =>
  globalThis.__TANSTACK_EVENT_TARGET__ ??
  (typeof window === "undefined" ? globalThis : window);

export const getNusmDevtoolsClient = () => {
  const target = getDevtoolsTarget();
  const existing = devtoolsClients.get(target);
  if (existing) return existing;
  const eventClient = new EventClient<NusmDevtoolsEventMap>({
    enabled: true,
    pluginId: "nusm",
  });
  const withTarget = <T>(operation: () => T): T => {
    if (!(target instanceof EventTarget)) return operation();
    const currentTarget = globalThis.__TANSTACK_EVENT_TARGET__;
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    try {
      return operation();
    } finally {
      globalThis.__TANSTACK_EVENT_TARGET__ = currentTarget;
    }
  };
  const client = {
    emit<TEvent extends keyof NusmDevtoolsEventMap & string>(
      eventSuffix: TEvent,
      payload: NusmDevtoolsEventMap[TEvent],
    ) {
      withTarget(() => eventClient.emit(eventSuffix, payload));
    },
    on<TEvent extends keyof NusmDevtoolsEventMap & string>(
      eventSuffix: TEvent,
      callback: (event: { payload: NusmDevtoolsEventMap[TEvent] }) => void,
    ) {
      const stop = withTarget(() => eventClient.on(eventSuffix, callback));
      return () => withTarget(stop);
    },
  };
  devtoolsClients.set(target, client);
  return client;
};

export const createNusmDevtoolsEmitter = (
  enabled: boolean,
  instanceId = "nusm-legacy-client",
) => {
  if (!enabled) return null;

  const client = getNusmDevtoolsClient();

  return {
    emitCommand: (command: NusmDevtoolsCommand) => {
      client.emit("command", command);
    },
    emitCommandResult: (
      result: Omit<NusmDevtoolsCommandResult, "instanceId">,
    ) => {
      client.emit("commandResult", { ...result, instanceId });
    },
    emitEvent: (event: Omit<NusmEvent, "instanceId">) => {
      client.emit("event", { ...event, instanceId });
    },
    emitHydration: (storeId: string, hydration: HydrationStatus) => {
      client.emit("hydration", { hydration, instanceId, storeId });
    },
    emitSnapshot: (snapshot: Omit<NusmDevtoolsSnapshot, "instanceId">) => {
      client.emit("snapshot", { ...snapshot, instanceId });
    },
    onCommand: (listener: (command: NusmDevtoolsCommand) => void) =>
      client.on("command", (event) => listener(event.payload)),
  };
};
