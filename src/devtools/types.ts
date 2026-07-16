import type {
  HydrationStatus,
  NusmDevtoolsSnapshot,
  NusmEvent,
} from "../types";

export type NusmDevtoolsLocation = "memory" | "persisted";

export type NusmDevtoolsPath = Array<string | number>;

export type NusmDevtoolsCommandInput =
  | { action: "refresh_all" }
  | { action: "refresh"; instanceId: string; storeId: string }
  | { action: "reset_memory"; instanceId: string; storeId: string }
  | {
      action: "replace_memory";
      instanceId: string;
      storeId: string;
      value: unknown;
    }
  | {
      action: "replace_persisted";
      instanceId: string;
      storeId: string;
      value: unknown;
    }
  | {
      action: "set_path";
      instanceId: string;
      location: NusmDevtoolsLocation;
      path: NusmDevtoolsPath;
      storeId: string;
      value: unknown;
    }
  | {
      action: "remove_path";
      instanceId: string;
      location: NusmDevtoolsLocation;
      path: NusmDevtoolsPath;
      storeId: string;
    };

export type NusmDevtoolsCommand = NusmDevtoolsCommandInput & {
  commandId: string;
};

export type NusmDevtoolsCommandResult = {
  action: NusmDevtoolsCommand["action"];
  commandId: string;
  error?: string;
  instanceId: string;
  status: "success" | "success_with_warning" | "error";
  storeId: string;
};

export type NusmDevtoolsEventMap = {
  command: NusmDevtoolsCommand;
  commandResult: NusmDevtoolsCommandResult;
  event: NusmEvent;
  hydration: {
    hydration: HydrationStatus;
    instanceId: string;
    storeId: string;
  };
  snapshot: NusmDevtoolsSnapshot;
};
