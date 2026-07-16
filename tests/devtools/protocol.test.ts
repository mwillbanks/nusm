import { describe, expect, test } from "bun:test";
import { parseNusmDevtoolsCommandResult } from "../../src/devtools/protocol";

describe("devtools protocol guards", () => {
  test("returns a frozen plain result from complete own fields", () => {
    const parsed = parseNusmDevtoolsCommandResult({
      action: "refresh",
      commandId: "command-1",
      error: "completed with a warning",
      instanceId: "instance-workspace",
      status: "success_with_warning",
      storeId: "workspace",
    });
    expect(parsed).toEqual({
      action: "refresh",
      commandId: "command-1",
      error: "completed with a warning",
      instanceId: "instance-workspace",
      status: "success_with_warning",
      storeId: "workspace",
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });

  test("rejects invalid, empty, inherited, and throwing envelopes", () => {
    expect(
      parseNusmDevtoolsCommandResult({
        action: "refresh",
        commandId: "command-1",
        instanceId: "instance-workspace",
        status: "definitely-invalid",
        storeId: "workspace",
      }),
    ).toBeUndefined();
    expect(
      parseNusmDevtoolsCommandResult({
        action: "future_action",
        commandId: "command-1",
        instanceId: "instance-workspace",
        status: "success",
        storeId: "workspace",
      }),
    ).toBeUndefined();
    expect(
      parseNusmDevtoolsCommandResult({
        action: "refresh",
        commandId: "",
        instanceId: "instance-workspace",
        status: "success",
        storeId: "workspace",
      }),
    ).toBeUndefined();
    expect(
      parseNusmDevtoolsCommandResult({
        action: "refresh",
        commandId: "command-1",
        instanceId: "instance-workspace",
        status: "success",
        storeId: "",
      }),
    ).toBeUndefined();
    expect(
      parseNusmDevtoolsCommandResult(
        Object.create({
          action: "refresh",
          commandId: "command-1",
          instanceId: "instance-workspace",
          status: "success",
          storeId: "workspace",
        }),
      ),
    ).toBeUndefined();
    expect(
      parseNusmDevtoolsCommandResult(
        new Proxy(
          {},
          {
            getOwnPropertyDescriptor: () => {
              throw new Error("hostile envelope");
            },
          },
        ),
      ),
    ).toBeUndefined();
  });

  test("reads stateful proxy and accessor fields exactly once", () => {
    let proxyStatusReads = 0;
    const statefulProxy = new Proxy(
      {
        action: "refresh",
        commandId: "command-1",
        instanceId: "instance-workspace",
        status: "success",
        storeId: "workspace",
      },
      {
        get: (target, property, receiver) => {
          if (property !== "status")
            return Reflect.get(target, property, receiver);
          proxyStatusReads += 1;
          return proxyStatusReads === 1 ? "success" : "definitely-invalid";
        },
      },
    );
    const parsedProxy = parseNusmDevtoolsCommandResult(statefulProxy);
    expect(parsedProxy?.status).toBe("success");
    expect(proxyStatusReads).toBe(1);

    const reads = new Map<string, number>();
    const accessorEnvelope = {};
    for (const [key, value] of Object.entries({
      action: "refresh",
      commandId: "command-2",
      instanceId: "instance-workspace",
      status: "success",
      storeId: "workspace",
    })) {
      Object.defineProperty(accessorEnvelope, key, {
        enumerable: true,
        get: () => {
          reads.set(key, (reads.get(key) ?? 0) + 1);
          return value;
        },
      });
    }
    const parsedAccessor = parseNusmDevtoolsCommandResult(accessorEnvelope);
    expect(parsedAccessor?.commandId).toBe("command-2");
    expect([...reads.values()]).toEqual([1, 1, 1, 1, 1]);
  });
});
