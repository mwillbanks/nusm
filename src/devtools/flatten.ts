import type { InspectionLimits, InspectorRow } from "./panel-model";
import type { NusmDevtoolsPath } from "./types";

type InspectionContext = {
  ancestors: Set<object>;
  formatPath: (path: NusmDevtoolsPath) => string;
  maxDepth: number;
  maxNodes: number;
  nodeCount: number;
  origins: WeakMap<object, NusmDevtoolsPath>;
  previewValue: (value: unknown) => string;
  rows: InspectorRow[];
  truncations: Set<string>;
};

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const inspectKeys = (candidate: object): Array<string | number> => {
  const keys = Reflect.ownKeys(candidate).filter(
    (key): key is string => typeof key === "string" && key !== "length",
  );
  if (!Array.isArray(candidate)) return keys;
  return keys.map(Number).filter((key) => Number.isInteger(key) && key >= 0);
};

const uninspectableRow = (
  path: NusmDevtoolsPath,
  key: string,
  error: unknown,
): InspectorRow => ({
  depth: path.length - 1,
  key,
  kind: "value",
  path,
  preview: `[Uninspectable: ${describeError(error)}]`,
  value: undefined,
});

const classifyProperty = (value: unknown, context: InspectionContext) => {
  const entry = typeof value === "object" && value !== null ? value : undefined;
  const circular = entry ? context.ancestors.has(entry) : false;
  const kind = Array.isArray(value) ? "array" : entry ? "object" : "value";
  const origin = entry ? context.origins.get(entry) : undefined;
  const preview = circular
    ? `[Circular → ${context.formatPath(origin ?? [])}]`
    : context.previewValue(value);
  return { circular, entry, kind, preview } as const;
};

const inspectDataProperty = (
  key: string,
  path: NusmDevtoolsPath,
  value: unknown,
  context: InspectionContext,
): { entry?: object; path: NusmDevtoolsPath; row: InspectorRow } => {
  const classification = classifyProperty(value, context);
  return {
    entry: classification.circular ? undefined : classification.entry,
    path,
    row: {
      depth: path.length - 1,
      key,
      kind: classification.kind,
      path,
      preview: classification.preview,
      value: classification.circular ? undefined : value,
    },
  };
};

const inspectDescriptor = (
  descriptor: PropertyDescriptor | undefined,
  key: string,
  path: NusmDevtoolsPath,
  context: InspectionContext,
): { entry?: object; path: NusmDevtoolsPath; row?: InspectorRow } => {
  if (!descriptor) return { path };
  if (!descriptor.enumerable) return { path };
  if ("value" in descriptor)
    return inspectDataProperty(key, path, descriptor.value, context);
  return {
    path,
    row: {
      depth: path.length - 1,
      key,
      kind: "value",
      path,
      preview: "[Accessor not evaluated]",
      value: undefined,
    },
  };
};

const inspectProperty = (
  candidate: object,
  key: string | number,
  currentPath: NusmDevtoolsPath,
  context: InspectionContext,
): { entry?: object; path: NusmDevtoolsPath; row?: InspectorRow } => {
  const propertyKey = String(key);
  const path = [...currentPath, key];
  try {
    return inspectDescriptor(
      Object.getOwnPropertyDescriptor(candidate, propertyKey),
      propertyKey,
      path,
      context,
    );
  } catch (error) {
    return { path, row: uninspectableRow(path, propertyKey, error) };
  }
};

const markTruncated = (
  currentPath: NusmDevtoolsPath,
  reason: "depth" | "nodes",
  context: InspectionContext,
) => {
  const id =
    reason === "nodes"
      ? reason
      : `${reason}:${context.formatPath(currentPath)}`;
  if (context.truncations.has(id)) return;
  context.truncations.add(id);
  context.rows.push({
    depth: currentPath.length,
    key: reason === "nodes" ? "Show more values" : "Expand nested values",
    kind: "value",
    path: [...currentPath, `<${reason}-truncated>`],
    preview:
      reason === "nodes"
        ? `${context.maxNodes.toLocaleString()}-row safety limit reached`
        : `${context.maxDepth}-level safety limit reached`,
    truncated: reason,
    value: undefined,
  });
};

const walkObject = (
  candidate: object,
  currentPath: NusmDevtoolsPath,
  context: InspectionContext,
): void => {
  if (currentPath.length >= context.maxDepth) {
    markTruncated(currentPath, "depth", context);
    return;
  }
  if (context.nodeCount >= context.maxNodes) {
    markTruncated(currentPath, "nodes", context);
    return;
  }
  context.ancestors.add(candidate);
  context.origins.set(candidate, currentPath);
  let keys: Array<string | number>;
  try {
    keys = inspectKeys(candidate);
  } catch (error) {
    context.rows.push(
      uninspectableRow(
        [...currentPath, "<uninspectable>"],
        "<uninspectable>",
        error,
      ),
    );
    context.ancestors.delete(candidate);
    return;
  }
  for (const key of keys) {
    if (context.nodeCount >= context.maxNodes) {
      markTruncated(currentPath, "nodes", context);
      break;
    }
    const inspected = inspectProperty(candidate, key, currentPath, context);
    if (inspected.row) {
      context.rows.push(inspected.row);
      context.nodeCount += 1;
    }
    if (inspected.entry) walkObject(inspected.entry, inspected.path, context);
  }
  context.ancestors.delete(candidate);
};

export const flattenInspectorValue = (
  value: unknown,
  query: string,
  path: NusmDevtoolsPath,
  formatPath: (path: NusmDevtoolsPath) => string,
  previewValue: (value: unknown) => string,
  limits: InspectionLimits,
): InspectorRow[] => {
  const rows: InspectorRow[] = [];
  if (typeof value === "object" && value !== null) {
    walkObject(value, path, {
      ancestors: new Set(),
      formatPath,
      maxDepth: limits.maxDepth ?? 16,
      maxNodes: limits.maxNodes ?? 2_000,
      nodeCount: 0,
      origins: new WeakMap(),
      previewValue,
      rows,
      truncations: new Set(),
    });
  }
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(
    (row) =>
      row.truncated ||
      `${formatPath(row.path)} ${row.preview}`.toLowerCase().includes(needle),
  );
};
