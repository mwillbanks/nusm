import "fake-indexeddb/auto";
import { describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { App } from "./App";
import {
  activityStore,
  preferencesStore,
  sessionStore,
  workspaceStore,
} from "./stores";

describe("example hydration readiness", () => {
  test("disables and guards adapter interactions before hydration", () => {
    const before = {
      activity: activityStore.state,
      preferences: preferencesStore.state,
      session: sessionStore.state,
      workspace: workspaceStore.state,
    };
    const view = render(
      <App
        readinessOverride={{
          activity: false,
          preferences: false,
          session: false,
          workspace: false,
        }}
      />,
    );
    const controls = [
      view.getByRole("button", { name: /Developer mode/ }),
      view.getByRole("button", { name: "Record IndexedDB activity" }),
      view.getByRole("button", { name: "Advance session workspace" }),
      view.getByRole("button", { name: /Add state/ }),
    ];
    for (const control of controls) {
      expect(control).toBeDisabled();
      expect(control).toHaveAttribute("aria-busy", "true");
      fireEvent.click(control);
    }
    expect(activityStore.state).toBe(before.activity);
    expect(preferencesStore.state).toBe(before.preferences);
    expect(sessionStore.state).toBe(before.session);
    expect(workspaceStore.state).toBe(before.workspace);
    cleanup();
  });
});
