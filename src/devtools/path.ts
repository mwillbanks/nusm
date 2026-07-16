import type { NusmDevtoolsPath } from "./types";

const blockedSegments = new Set(["__proto__", "constructor", "prototype"]);

const assertSegment = (segment: string | number) => {
  if (typeof segment === "string" && blockedSegments.has(segment)) {
    throw new Error(`Unsafe path segment: ${segment}.`);
  }
  if (
    typeof segment === "number" &&
    (!Number.isSafeInteger(segment) || segment < 0)
  ) {
    throw new Error("Array paths require a non-negative safe integer.");
  }
};

const isContainer = (
  value: unknown,
): value is Record<string, unknown> | unknown[] =>
  typeof value === "object" && value !== null;

type OwnDataValue = { exists: boolean; value: unknown };

const readOwnDataValue = (
  container: Record<string, unknown> | unknown[],
  segment: string | number,
): OwnDataValue => {
  const descriptor = Object.getOwnPropertyDescriptor(
    container,
    String(segment),
  );
  if (!descriptor) return { exists: false, value: undefined };
  if (!("value" in descriptor))
    throw new Error("Accessor properties cannot be edited through Devtools.");
  return { exists: true, value: descriptor.value };
};

const copyOwnDataProperties = (source: object, target: object) => {
  for (const key of Reflect.ownKeys(source)) {
    if (key === "length") continue;
    if (typeof key === "symbol")
      throw new Error("Symbol properties cannot be edited through Devtools.");
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor?.enumerable) continue;
    if (!("value" in descriptor))
      throw new Error("Accessor properties cannot be edited through Devtools.");
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }
};

const defineDataProperty = (
  target: Record<string, unknown> | unknown[],
  segment: string | number,
  value: unknown,
) => {
  Object.defineProperty(target, String(segment), {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
};

const createObjectContainer = (): Record<string, unknown> =>
  Object.create(null);

const cloneContainer = (value: unknown, nextSegment?: string | number) => {
  if (Array.isArray(value)) {
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    const target = new Array(typeof length === "number" ? length : 0);
    copyOwnDataProperties(value, target);
    return target;
  }
  if (isContainer(value)) {
    const target = createObjectContainer();
    copyOwnDataProperties(value, target);
    return target;
  }
  return typeof nextSegment === "number" ? [] : createObjectContainer();
};

const assertEditableSegment = (
  container: Record<string, unknown> | unknown[],
  segment: string | number,
  allowAppend: boolean,
) => {
  if (!Array.isArray(container)) return;
  if (typeof segment !== "number") {
    throw new Error("Array paths require numeric segments.");
  }
  const limit = allowAppend ? container.length : container.length - 1;
  if (segment > limit) {
    throw new Error(`Array index ${segment} is outside the editable range.`);
  }
};

const removeArrayIndex = (source: unknown[], index: number) => {
  const result: unknown[] = [];
  const length = source.length;
  for (let current = 0; current < length; current += 1) {
    if (current === index) continue;
    const property = readOwnDataValue(source, current);
    if (property.exists)
      defineDataProperty(
        result,
        current < index ? current : current - 1,
        property.value,
      );
  }
  return result;
};

export const getValueAtPath = (
  value: unknown,
  path: NusmDevtoolsPath,
): unknown => {
  let current = value;
  for (const segment of path) {
    assertSegment(segment);
    if (!isContainer(current)) return undefined;
    const property = readOwnDataValue(current, segment);
    if (!property.exists) return undefined;
    current = property.value;
  }
  return current;
};

export const setValueAtPath = (
  root: unknown,
  path: NusmDevtoolsPath,
  value: unknown,
): unknown => {
  if (path.length === 0) return value;
  path.forEach(assertSegment);
  const setAtDepth = (source: unknown, depth: number): unknown => {
    const segment = path[depth] as string | number;

    const target = cloneContainer(source, segment);
    assertEditableSegment(target, segment, true);
    if (depth === path.length - 1) {
      defineDataProperty(target, segment, value);
      return target;
    }
    const sourceChild = isContainer(source)
      ? readOwnDataValue(source, segment).value
      : undefined;
    defineDataProperty(target, segment, setAtDepth(sourceChild, depth + 1));
    return target;
  };
  return setAtDepth(root, 0);
};

export const removeValueAtPath = (
  root: unknown,
  path: NusmDevtoolsPath,
): unknown => {
  if (path.length === 0) throw new Error("The root value cannot be removed.");
  path.forEach(assertSegment);
  const removeAtDepth = (source: unknown, depth: number): unknown => {
    if (!isContainer(source))
      throw new Error("The selected path does not exist.");
    const segment = path[depth] as string | number;
    assertEditableSegment(source, segment, false);
    const property = readOwnDataValue(source, segment);
    if (!property.exists) throw new Error("The selected path does not exist.");
    const target = cloneContainer(source, path[depth + 1]);
    if (depth === path.length - 1) {
      if (Array.isArray(target))
        return removeArrayIndex(target, segment as number);
      delete target[segment as never];
      return target;
    }
    defineDataProperty(
      target,
      segment,
      removeAtDepth(property.value, depth + 1),
    );
    return target;
  };
  return removeAtDepth(root, 0);
};
