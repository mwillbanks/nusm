import "fake-indexeddb/auto";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { App } from "./App";
import {
  activityStore,
  preferencesStore,
  sessionStore,
  storesReady,
  workspaceStore,
} from "./stores";

afterEach(cleanup);

describe("nusm example", () => {
  test("renders all adapter scenarios and updates nusm state through React", async () => {
    await storesReady;
    const view = render(<App />);
    expect(view.getByText("Everything in motion,")).toBeInTheDocument();
    expect(view.getByText("localStorage")).toBeInTheDocument();
    expect(view.getByText("sessionStorage")).toBeInTheDocument();
    expect(view.getByText("IndexedDB")).toBeInTheDocument();

    const before = workspaceStore.state.tasks.length;
    fireEvent.click(view.getByRole("button", { name: /Add state/ }));
    expect(workspaceStore.state.tasks).toHaveLength(before + 1);
    expect(view.getByText("Inspect the live store graph")).toBeInTheDocument();
    const previousTheme = preferencesStore.state.theme;
    const previousDrafts = sessionStore.state.drafts;
    const previousEvents = activityStore.state.events.length;
    fireEvent.click(view.getByRole("button", { name: /Developer mode/ }));
    fireEvent.click(
      view.getByRole("button", { name: "Advance session workspace" }),
    );
    fireEvent.click(
      view.getByRole("button", { name: "Record IndexedDB activity" }),
    );
    expect(preferencesStore.state.theme).not.toBe(previousTheme);
    expect(sessionStore.state.drafts).toBe(previousDrafts + 1);
    expect(sessionStore.state.lastCommand).toBe("Session checkpoint");
    expect(activityStore.state.events).toHaveLength(previousEvents + 1);
    expect(activityStore.state.events[0]?.label).toBe(
      "Devtools inspection recorded",
    );
  });

  test("filters the live memory store task list", async () => {
    await storesReady;
    const view = render(<App />);
    fireEvent.change(view.getByLabelText("Filter workspace tasks"), {
      target: { value: "telemetry" },
    });
    expect(view.getByText("Polish launch telemetry")).toBeInTheDocument();
    expect(view.getAllByRole("button", { name: /telemetry/i })).toHaveLength(1);
  });
});
