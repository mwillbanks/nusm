import { flattenInspectorValue } from "./flatten.js";
import type { NusmDevtoolsPath } from "./types.js";

export type InspectorRow = {
  depth: number;
  key: string;
  kind: "array" | "object" | "value";
  path: NusmDevtoolsPath;
  preview: string;
  truncated?: "depth" | "nodes";
  value: unknown;
};

export type InspectionLimits = {
  maxDepth?: number;
  maxNodes?: number;
};

export const formatPath = (path: NusmDevtoolsPath) =>
  path.reduce<string>(
    (result, segment) =>
      typeof segment === "number"
        ? `${result}[${segment}]`
        : `${result}[${JSON.stringify(segment)}]`,
    "$",
  );

export const parsePath = (input: string): NusmDevtoolsPath => {
  const source = input.trim();
  if (source === "" || source === "$") return [];
  const path: NusmDevtoolsPath = [];
  let cursor = source.startsWith("$") ? 1 : 0;
  while (cursor < source.length) {
    const remainder = source.slice(cursor);
    const numeric = remainder.match(/^\[(0|[1-9]\d*)\]/);
    if (numeric) {
      path.push(Number(numeric[1]));
      cursor += numeric[0].length;
      continue;
    }
    const quoted = remainder.match(/^\[((?:"(?:\\.|[^"\\])*"))\]/);
    if (quoted) {
      path.push(JSON.parse(quoted[1] ?? ""));
      cursor += quoted[0].length;
      continue;
    }
    const dotted = remainder.match(/^\.?([A-Za-z_$][\w$]*)/);
    if (
      dotted &&
      (cursor === 0 ? !remainder.startsWith(".") : remainder.startsWith("."))
    ) {
      path.push(dotted[1] ?? "");
      cursor += dotted[0].length;
      continue;
    }
    throw new Error(
      'Invalid JSON path. Use profile.name, items[0], or $["literal.key"].',
    );
  }
  return path;
};

export const previewValue = (value: unknown) => {
  if (typeof value === "string") return `“${value}”`;
  if (typeof value !== "object" || value === null) return String(value);
  try {
    if (Array.isArray(value)) {
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
      return `Array(${typeof length === "number" ? length : "?"})`;
    }
    return `{${Reflect.ownKeys(value).filter((key) => typeof key === "string").length} keys}`;
  } catch (error) {
    return `[Uninspectable: ${error instanceof Error ? error.message : String(error)}]`;
  }
};

export const flattenValue = (
  value: unknown,
  query = "",
  path: NusmDevtoolsPath = [],
  limits: InspectionLimits = {},
): InspectorRow[] =>
  flattenInspectorValue(value, query, path, formatPath, previewValue, limits);
