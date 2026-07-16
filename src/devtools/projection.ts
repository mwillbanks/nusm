type ProjectionContext = {
  ancestors: Map<object, string>;
  depth: number;
  path: string;
};

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const projectPrimitive = (
  value: unknown,
): { handled: boolean; value: unknown } => {
  if (typeof value === "bigint") return { handled: true, value: `${value}n` };
  if (typeof value === "function")
    return { handled: true, value: "[Function]" };
  if (typeof value === "symbol") return { handled: true, value: String(value) };
  return {
    handled: typeof value !== "object" || value === null,
    value,
  };
};

const assignProjected = (
  output: unknown[] | Record<string, unknown>,
  key: string,
  value: unknown,
) => {
  Object.defineProperty(output, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
};

const projectProperty = (
  source: object,
  key: string,
  context: ProjectionContext,
): unknown => {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(source, key);
  } catch (error) {
    return `[Uninspectable: ${describeError(error)}]`;
  }
  if (!descriptor?.enumerable) return undefined;
  if (!("value" in descriptor)) return "[Accessor not evaluated]";
  return projectForDisplay(descriptor.value, {
    ancestors: context.ancestors,
    depth: context.depth + 1,
    path: `${context.path}[${JSON.stringify(key)}]`,
  });
};

const projectObject = (value: object, context: ProjectionContext): unknown => {
  const origin = context.ancestors.get(value);
  if (origin) return `[Circular → ${origin}]`;
  if (context.depth >= 16) return "[Max depth reached]";
  context.ancestors.set(value, context.path);
  try {
    const keys = Reflect.ownKeys(value).filter(
      (key): key is string => typeof key === "string" && key !== "length",
    );
    const output: unknown[] | Record<string, unknown> = Array.isArray(value)
      ? []
      : Object.create(null);
    for (const key of keys.slice(0, 2_000)) {
      const projected = projectProperty(value, key, context);
      if (projected !== undefined) assignProjected(output, key, projected);
    }
    return output;
  } catch (error) {
    return `[Uninspectable: ${describeError(error)}]`;
  } finally {
    context.ancestors.delete(value);
  }
};

export const projectForDisplay = (
  value: unknown,
  context: ProjectionContext = { ancestors: new Map(), depth: 0, path: "$" },
): unknown => {
  const primitive = projectPrimitive(value);
  return primitive.handled
    ? primitive.value
    : projectObject(value as object, context);
};
