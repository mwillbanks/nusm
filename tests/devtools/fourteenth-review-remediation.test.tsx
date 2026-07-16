import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createNusmStore } from "../../src";
import { NusmDevtoolsPanel } from "../../src/devtools/panel";

const _tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const relay = () => {
  const target = new EventTarget();
  target.addEventListener("tanstack-connect", () =>
    target.dispatchEvent(new CustomEvent("tanstack-connect-success")),
  );
  target.addEventListener("tanstack-dispatch-event", (event) => {
    const detail = (event as CustomEvent<{ payload: unknown; type: string }>)
      .detail;
    target.dispatchEvent(new CustomEvent(detail.type, { detail }));
  });
  return target;
};
const instanceLabel = (instanceId: string) =>
  `instance ${instanceId.replace(/^nusm-instance-/, "")}`;

afterEach(() => {
  cleanup();
  delete globalThis.__TANSTACK_EVENT_TARGET__;
});

describe("cross-module identity and visible store discrimination", () => {
  test("targets one store across independently evaluated nusm modules", async () => {
    const probeSource = `
    const target = new EventTarget();
    target.addEventListener("tanstack-connect", () =>
      target.dispatchEvent(new CustomEvent("tanstack-connect-success")),
    );
    target.addEventListener("tanstack-dispatch-event", (event) => {
      const detail = event.detail;
      target.dispatchEvent(new CustomEvent(detail.type, { detail }));
    });
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const moduleA = await import("./src/nusm.ts?devtools-copy=one");
    const moduleB = await import("./src/nusm.ts?devtools-copy=two");
    const first = moduleA.createNusmStore(
      { value: "first" },
      { devtools: true, storeId: "same" },
    );
    const second = moduleB.createNusmStore(
      { value: "second" },
      { devtools: true, storeId: "same" },
    );
    await Promise.all([first.ready, second.ready]);
    target.dispatchEvent(
      new CustomEvent("nusm:command", {
        detail: {
          payload: {
            action: "replace_memory",
            commandId: "cross-module-target",
            instanceId: first.devtoolsInstanceId,
            storeId: "same",
            value: { value: "targeted" },
          },
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    console.log(
      JSON.stringify({
        firstId: first.devtoolsInstanceId,
        firstState: first.state,
        secondId: second.devtoolsInstanceId,
        secondState: second.state,
      }),
    );
    `;
    const probe = Bun.spawn(["bun", "-e", probeSource], {
      cwd: `${import.meta.dir}/../..`,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stderr, stdout] = await Promise.all([
      probe.exited,
      new Response(probe.stderr).text(),
      new Response(probe.stdout).text(),
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout) as {
      firstId: string;
      firstState: { value: string };
      secondId: string;
      secondState: { value: string };
    };
    expect(result.firstId).not.toBe(result.secondId);
    expect(result.firstState).toEqual({ value: "targeted" });
    expect(result.secondState).toEqual({ value: "second" });
  });

  test("exposes a searchable stable discriminator before store selection", async () => {
    const target = relay();
    globalThis.__TANSTACK_EVENT_TARGET__ = target;
    const first = createNusmStore(
      { value: "first" },
      { devtools: true, storeId: "same" },
    );
    const second = createNusmStore(
      { value: "second" },
      { devtools: true, storeId: "same" },
    );
    await Promise.all([first.ready, second.ready]);
    const view = render(<NusmDevtoolsPanel theme="dark" />);
    const firstName = `Memory-only store same memory only · ${instanceLabel(first.devtoolsInstanceId)}`;
    const secondName = `Memory-only store same memory only · ${instanceLabel(second.devtoolsInstanceId)}`;

    await waitFor(() =>
      expect(view.getByRole("button", { name: firstName })).toBeInTheDocument(),
    );
    expect(view.getByRole("button", { name: secondName })).toBeInTheDocument();
    expect(firstName).not.toBe(secondName);
    fireEvent.click(view.getByRole("button", { name: secondName }));
    expect(
      view.getByText(`same · ${instanceLabel(second.devtoolsInstanceId)}`),
    ).toBeInTheDocument();

    fireEvent.change(view.getByRole("textbox", { name: "Search stores" }), {
      target: { value: first.devtoolsInstanceId },
    });
    expect(view.getByRole("button", { name: firstName })).toBeInTheDocument();
    expect(
      view.queryByRole("button", { name: secondName }),
    ).not.toBeInTheDocument();
  });
});
