import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import React, { act } from "react";
import { createNusmStore } from "../../src";
import { useStore } from "../../src/react";

describe("useStore", () => {
  test("returns selected state and updates", () => {
    const store = createNusmStore({ count: 0 });

    function Counter() {
      const count = useStore(store, (state) => state.count);
      return React.createElement("span", null, String(count));
    }

    const { getByText, queryByText } = render(React.createElement(Counter));
    expect(getByText("0")).toBeTruthy();

    act(() => {
      store.setState((state) => ({ ...state, count: state.count + 1 }));
    });

    expect(queryByText("1")).toBeTruthy();
  });

  test("uses deep equality when enabled", () => {
    const store = createNusmStore({ nested: { value: 1 } });
    let changed = 0;

    function Counter() {
      const selected = useStore(store, (state) => ({ nested: state.nested }), {
        equal: true,
      });
      const prev = React.useRef(selected);

      if (prev.current !== selected) {
        changed += 1;
        prev.current = selected;
      }

      return React.createElement("span", null, String(selected.nested.value));
    }

    const { getByText } = render(React.createElement(Counter));
    expect(getByText("1")).toBeTruthy();

    act(() => {
      store.setState((state) => ({ nested: { ...state.nested } }));
    });

    expect(changed).toBe(0);
  });

  test("uses default selector when omitted", () => {
    const store = createNusmStore({ count: 0 });

    function Counter() {
      const state = useStore(store);
      return React.createElement("span", null, String(state.count));
    }

    const { getByText, queryByText } = render(React.createElement(Counter));
    expect(getByText("0")).toBeTruthy();

    act(() => {
      store.setState((state) => ({ ...state, count: state.count + 1 }));
    });

    expect(queryByText("1")).toBeTruthy();
  });
});
