import { EventClient } from "@tanstack/devtools-event-client";
import type {
  HydrationStatus,
  NusmDevtoolsSnapshot,
  NusmEvent,
} from "../types";

export type NusmDevtoolsEventMap = {
  "nusm:snapshot": NusmDevtoolsSnapshot;
  "nusm:event": NusmEvent;
  "nusm:hydration": { storeId: string; hydration: HydrationStatus };
};

export const createNusmDevtoolsEmitter = (enabled: boolean) => {
  if (!enabled) return null;

  const client = new EventClient<NusmDevtoolsEventMap, "nusm">({
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
