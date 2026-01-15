import type { TanStackDevtoolsPlugin } from "@tanstack/devtools";
import type { NusmDevtoolsSnapshot, NusmEvent } from "../types";

type DevtoolsEventDetail<TPayload> = {
  payload: TPayload;
};

export const createNusmDevtoolsPlugin = (): TanStackDevtoolsPlugin => {
  const pluginId = "nusm";

  return {
    defaultOpen: true,
    id: pluginId,
    name: "nusm",
    render: (el) => {
      const container = document.createElement("div");
      container.style.display = "grid";
      container.style.gap = "12px";
      container.style.fontFamily = "monospace";

      const snapshotTitle = document.createElement("h3");
      snapshotTitle.textContent = "Snapshot";
      snapshotTitle.style.margin = "0";

      const snapshotPre = document.createElement("pre");
      snapshotPre.style.whiteSpace = "pre-wrap";
      snapshotPre.style.margin = "0";
      snapshotPre.textContent = "No snapshot yet.";

      const eventsTitle = document.createElement("h3");
      eventsTitle.textContent = "Events";
      eventsTitle.style.margin = "0";

      const eventsPre = document.createElement("pre");
      eventsPre.style.whiteSpace = "pre-wrap";
      eventsPre.style.margin = "0";
      eventsPre.textContent = "No events yet.";

      container.appendChild(snapshotTitle);
      container.appendChild(snapshotPre);
      container.appendChild(eventsTitle);
      container.appendChild(eventsPre);
      el.appendChild(container);

      const onSnapshot = (event: Event) => {
        const detail = (
          event as CustomEvent<DevtoolsEventDetail<NusmDevtoolsSnapshot>>
        ).detail;
        if (!detail?.payload) return;
        snapshotPre.textContent = JSON.stringify(detail.payload, null, 2);
      };

      const onEvent = (event: Event) => {
        const detail = (event as CustomEvent<DevtoolsEventDetail<NusmEvent>>)
          .detail;
        if (!detail?.payload) return;
        const existing = eventsPre.textContent ?? "";
        const line = JSON.stringify(detail.payload);
        eventsPre.textContent =
          existing === "No events yet." ? line : `${existing}\n${line}`;
      };

      window.addEventListener(`${pluginId}:snapshot`, onSnapshot);
      window.addEventListener(`${pluginId}:event`, onEvent);

      return () => {
        window.removeEventListener(`${pluginId}:snapshot`, onSnapshot);
        window.removeEventListener(`${pluginId}:event`, onEvent);
        el.innerHTML = "";
      };
    },
  };
};
