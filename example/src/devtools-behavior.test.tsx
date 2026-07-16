import "fake-indexeddb/auto";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { App, resolveExampleDevtoolsEnabled } from "./App";
import {
  activityStore,
  sessionStore,
  storesReady,
  workspaceStore,
} from "./stores";

afterEach(cleanup);

describe("example devtools experience", () => {
  test("enables the real panel only for development or an explicit opt-in", () => {
    expect(resolveExampleDevtoolsEnabled(undefined, "")).toBe(false);
    expect(resolveExampleDevtoolsEnabled({}, "")).toBe(true);
    expect(resolveExampleDevtoolsEnabled(undefined, "?devtools")).toBe(true);
  });

  test("provides working navigation and a cross-adapter quick command", async () => {
    await storesReady;
    const view = render(<App />);
    fireEvent.click(view.getByRole("button", { name: /Stores/ }));
    expect(view.getByRole("button", { name: /Stores/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const previousRuns = workspaceStore.state.commandRuns;
    const previousEvents = activityStore.state.events.length;
    fireEvent.click(view.getByRole("button", { name: /Quick command/ }));
    expect(workspaceStore.state.commandRuns).toBe(previousRuns + 1);
    expect(activityStore.state.events).toHaveLength(previousEvents + 1);
    expect(sessionStore.state.lastCommand).toBe("Quick command");
    expect(view.getByRole("button", { name: /Signals/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("reports adapter failures as degraded instead of hardcoded healthy", async () => {
    await storesReady;
    const view = render(
      <App
        failureOverride={{ activity: true }}
        readinessOverride={{ activity: false }}
      />,
    );
    expect(view.getByText("Degraded")).toBeInTheDocument();
    expect(view.getByText("DEGRADED")).toBeInTheDocument();
    expect(view.getByText("Error")).toBeInTheDocument();
  });
});
