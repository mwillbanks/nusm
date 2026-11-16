import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { NusmAdapter } from "nusm";

const usage = "Usage: bun check-adapter.ts <test-adapter-module>";

function isAdapter(value: unknown): value is NusmAdapter {
  return (
    value !== null &&
    typeof value === "object" &&
    "name" in value &&
    typeof value.name === "string" &&
    "getItem" in value &&
    typeof value.getItem === "function" &&
    "setItem" in value &&
    typeof value.setItem === "function" &&
    "removeItem" in value &&
    typeof value.removeItem === "function"
  );
}

export async function checkAdapter(
  adapter: NusmAdapter,
  key: string,
): Promise<void> {
  if ((await adapter.getItem(key)) !== null) {
    throw new Error("A new key must return null.");
  }

  const failures: unknown[] = [];
  try {
    await adapter.setItem(key, "nusm adapter check");
    if ((await adapter.getItem(key)) !== "nusm adapter check") {
      throw new Error("The adapter did not return the written value.");
    }
  } catch (error) {
    failures.push(error);
  }

  try {
    await adapter.removeItem(key);
    if ((await adapter.getItem(key)) !== null) {
      throw new Error("The adapter did not remove the test key.");
    }
  } catch (error) {
    failures.push(error);
  }

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "The adapter check and cleanup failed.");
  }
}

if (import.meta.main) {
  const [input, ...extra] = process.argv.slice(2);
  if (input === "--help" && extra.length === 0) {
    console.log(usage);
  } else if (!input || input.startsWith("-") || extra.length !== 0) {
    console.error(usage);
    process.exitCode = 2;
  } else {
    try {
      const module = await import(pathToFileURL(resolve(input)).href);
      const adapter: unknown = module.default;
      if (!isAdapter(adapter)) {
        throw new Error("Export a test adapter as the module's default value.");
      }
      await checkAdapter(adapter, `nusm:adapter-check:${randomUUID()}`);
      console.log("Adapter round trip passed.");
    } catch (error) {
      if (error instanceof AggregateError) {
        console.error(error.message);
        for (const failure of error.errors) {
          console.error(
            failure instanceof Error ? failure.message : String(failure),
          );
        }
      } else {
        console.error(error instanceof Error ? error.message : String(error));
      }
      process.exitCode = 1;
    }
  }
}
