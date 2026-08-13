import type { NusmDevtoolsCommandResult } from "./types.js";

export { getNusmDevtoolsClient } from "./client.js";

const commandActions = new Set<NusmDevtoolsCommandResult["action"]>([
  "refresh_all",
  "refresh",
  "reset_memory",
  "replace_memory",
  "replace_persisted",
  "set_path",
  "remove_path",
]);
const commandStatuses = new Set<NusmDevtoolsCommandResult["status"]>([
  "success",
  "success_with_warning",
  "error",
]);

export const parseNusmDevtoolsCommandResult = (
  value: unknown,
): Readonly<NusmDevtoolsCommandResult> | undefined => {
  try {
    if (typeof value !== "object" || value === null) return undefined;
    const candidate = value as Record<string, unknown>;
    if (
      !Object.hasOwn(candidate, "action") ||
      !Object.hasOwn(candidate, "commandId") ||
      !Object.hasOwn(candidate, "instanceId") ||
      !Object.hasOwn(candidate, "status") ||
      !Object.hasOwn(candidate, "storeId")
    )
      return undefined;
    const action = candidate.action;
    const commandId = candidate.commandId;
    const instanceId = candidate.instanceId;
    const status = candidate.status;
    const storeId = candidate.storeId;
    const error = Object.hasOwn(candidate, "error")
      ? candidate.error
      : undefined;
    if (
      typeof commandId !== "string" ||
      commandId.length === 0 ||
      typeof instanceId !== "string" ||
      instanceId.length === 0 ||
      typeof storeId !== "string" ||
      storeId.length === 0 ||
      !commandActions.has(action as NusmDevtoolsCommandResult["action"]) ||
      !commandStatuses.has(status as NusmDevtoolsCommandResult["status"]) ||
      (error !== undefined && typeof error !== "string")
    )
      return undefined;
    return Object.freeze({
      action: action as NusmDevtoolsCommandResult["action"],
      commandId,
      error,
      instanceId,
      status: status as NusmDevtoolsCommandResult["status"],
      storeId,
    });
  } catch {
    return undefined;
  }
};
