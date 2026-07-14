import { EventClient } from "@tanstack/devtools-event-client/production";
import type {
  HydrationStatus,
  NusmDevtoolsSnapshot,
  NusmEvent,
} from "../types";

// fallow-ignore-next-line unused-type
export type NusmDevtoolsEventMap = {
  snapshot: NusmDevtoolsSnapshot;
  event: NusmEvent;
  hydration: { storeId: string; hydration: HydrationStatus };
};

export const createNusmDevtoolsEmitter = (enabled: boolean) => {
  if (!enabled) return null;

  const client = new EventClient<NusmDevtoolsEventMap>({
    enabled: true,
    pluginId: "nusm",
  });

  return {
    emitEvent: (event: NusmEvent) => {
      client.emit("event", event);
    },
    emitHydration: (storeId: string, hydration: HydrationStatus) => {
      client.emit("hydration", { hydration, storeId });
    },
    emitSnapshot: (snapshot: NusmDevtoolsSnapshot) => {
      client.emit("snapshot", snapshot);
    },
  };
};
