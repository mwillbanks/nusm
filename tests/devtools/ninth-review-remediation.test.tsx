import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { NusmDevtoolsPanel } from "../../src/devtools/panel";

afterEach(cleanup);

describe("ninth semantic review remediations", () => {
  test("opens a labelled About tabpanel without an instrumented store", () => {
    const view = render(<NusmDevtoolsPanel devtoolsOpen theme="dark" />);

    fireEvent.click(view.getByRole("button", { name: "About" }));

    expect(view.getByText("nusm Devtools")).toBeInTheDocument();
    expect(
      view.getByText(
        "Bidirectional state inspection powered by TanStack Devtools.",
      ),
    ).toBeInTheDocument();
    const tab = view.getByRole("tab", { name: "about", selected: true });
    const panel = view.getByRole("tabpanel");
    expect(tab).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", tab.id);
    expect(view.queryByText("No instrumented stores yet")).toBeNull();
  });
});
