import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import React, { act } from "react";
import { createNusmStore } from "../../src";
import { useStore } from "../../src/react";

describe("useStore", () => {
  test("stabilizes allocated selections between store updates", () => {
    const store = createNusmStore({ count: 1 });
    let commits = 0;
    function Value() {
      React.useLayoutEffect(() => {
        commits += 1;
      });
      const selected = useStore(store, (state) => ({
        nested: { count: state.count },
      }));
      return React.createElement("span", null, selected.nested.count);
    }
    const view = render(React.createElement(Value));
    expect(view.getByText("1")).toBeTruthy();
    act(() => {
      store.setState(() => ({ count: 2 }));
    });
    expect(view.getByText("2")).toBeTruthy();
    expect(commits).toBe(2);
  });

  test("updates selector inputs before committing consumer effects", () => {
    const store = createNusmStore({ first: 1, second: 2 });
    const committed: number[] = [];
    function Value({ field }: { field: "first" | "second" }) {
      const value = useStore(store, (state) => state[field]);
      React.useLayoutEffect(() => {
        committed.push(value);
      }, [value]);
      return React.createElement("span", null, value);
    }
    const view = render(React.createElement(Value, { field: "first" }));
    view.rerender(React.createElement(Value, { field: "second" }));
    expect(view.getByText("2")).toBeTruthy();
    expect(committed).toEqual([1, 2]);
  });

  test("returns function selections without invoking them", () => {
    let calls = 0;
    const handler = () => {
      calls += 1;
    };
    const store = createNusmStore({ handler });
    function Action() {
      const selected = useStore(store, (state) => state.handler);
      return React.createElement("button", { onClick: selected }, "Run");
    }
    const view = render(React.createElement(Action));
    expect(calls).toBe(0);
    act(() => {
      view.getByText("Run").click();
    });
    expect(calls).toBe(1);
  });

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
      React.useEffect(() => {
        if (prev.current !== selected) {
          changed += 1;
          prev.current = selected;
        }
      }, [selected]);

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
