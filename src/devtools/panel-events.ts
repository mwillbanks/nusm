import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { NusmDevtoolsSnapshot } from "../types.js";
import {
  parseNusmDevtoolsCommandResult,
  type getNusmDevtoolsClient,
} from "./protocol.js";
import type { EditorState } from "./panel-editor.js";
import type { RetainedEvent } from "./panel-view.js";
import type { NusmDevtoolsCommandInput } from "./types.js";

type DevtoolsClient = ReturnType<typeof getNusmDevtoolsClient>;
type PendingCommand = {
  action: NusmDevtoolsCommandInput["action"];
  instanceId?: string;
  storeId?: string;
  timeoutId: ReturnType<typeof setTimeout>;
};
type ParsedCommandResult = NonNullable<
  ReturnType<typeof parseNusmDevtoolsCommandResult>
>;

const matchesPendingCommand = (
  pending: PendingCommand | undefined,
  result: ParsedCommandResult,
): pending is PendingCommand =>
  Boolean(
    pending &&
    pending.action === result.action &&
    [undefined, result.instanceId].includes(pending.instanceId) &&
    [undefined, result.storeId].includes(pending.storeId),
  );

export const usePanelEventBridge = ({
  client,
  panelId,
  setEditor,
}: {
  client: DevtoolsClient;
  panelId: string;
  setEditor: Dispatch<SetStateAction<EditorState | undefined>>;
}) => {
  const commandSequence = useRef(0);
  const pendingCommands = useRef(new Map<string, PendingCommand>());
  const eventCaps = useRef(new Map<string, number>());
  const eventSequence = useRef(0);
  const [snapshots, setSnapshots] = useState<Map<string, NusmDevtoolsSnapshot>>(
    new Map(),
  );
  const [events, setEvents] = useState<Map<string, RetainedEvent[]>>(new Map());
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>();
  const [status, setStatus] = useState("Listening for instrumented stores…");
  const [statusOk, setStatusOk] = useState(false);
  const nextCommandId = (prefix: string) =>
    `${prefix}-${++commandSequence.current}`;

  useEffect(() => {
    const stopSnapshot = client.on("snapshot", ({ payload }) => {
      const cap = Math.max(1, payload.eventLogCap ?? 100);
      eventCaps.current.set(payload.instanceId, cap);
      setEvents((current) => {
        const next = new Map(current);
        next.set(
          payload.instanceId,
          (next.get(payload.instanceId) ?? []).slice(0, cap),
        );
        return next;
      });
      setSnapshots((current) =>
        new Map(current).set(payload.instanceId, payload),
      );
      setSelectedInstanceId((current) => current ?? payload.instanceId);
      setStatus("Store snapshot received");
      setStatusOk(true);
    });
    const stopEvent = client.on("event", ({ payload }) => {
      const retained: RetainedEvent = {
        ...payload,
        devtoolsEventId: `${panelId}-${++eventSequence.current}`,
      };
      setEvents((current) => {
        const next = new Map(current);
        const cap = eventCaps.current.get(payload.instanceId) ?? 100;
        next.set(
          payload.instanceId,
          [retained, ...(next.get(payload.instanceId) ?? [])].slice(0, cap),
        );
        return next;
      });
    });
    const stopResult = client.on("commandResult", ({ payload }) => {
      const result = parseNusmDevtoolsCommandResult(payload);
      if (!result) return;
      const pending = pendingCommands.current.get(result.commandId);
      if (!matchesPendingCommand(pending, result)) return;
      clearTimeout(pending.timeoutId);
      pendingCommands.current.delete(result.commandId);
      setStatus(
        result.error ?? `${result.action.replaceAll("_", " ")} complete`,
      );
      setStatusOk(result.status !== "error");
      if (result.status !== "error") setEditor(undefined);
    });
    client.emit("command", {
      action: "refresh_all",
      commandId: nextCommandId(`nusm-panel-sync-${panelId}`),
    });
    const commands = pendingCommands.current;
    return () => {
      for (const pending of commands.values()) clearTimeout(pending.timeoutId);
      commands.clear();
      stopResult();
      stopEvent();
      stopSnapshot();
    };
  }, [client, panelId, setEditor]);

  return {
    nextCommandId,
    events,
    pendingCommands,
    selectedInstanceId,
    setSelectedInstanceId,
    setSnapshots,
    setStatus,
    setStatusOk,
    snapshots,
    status,
    statusOk,
  };
};
