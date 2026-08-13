import { projectForDisplay } from "./projection.js";

const isJsonPrimitive = (value: unknown): boolean => {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  return typeof value === "number" && Number.isFinite(value);
};

const isDataDescriptor = (
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { value: unknown } =>
  descriptor !== undefined &&
  "value" in descriptor &&
  descriptor.get === undefined &&
  descriptor.set === undefined;

const isJsonArray = (value: unknown[], ancestors: Set<object>): boolean => {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === "symbol")) return false;
  if (keys.length !== value.length + 1) return false;
  return Array.from({ length: value.length }, (_, index) => index).every(
    (index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      return (
        isDataDescriptor(descriptor) &&
        descriptor.enumerable === true &&
        isJsonDomainValue(descriptor.value, ancestors)
      );
    },
  );
};

const isJsonRecord = (value: object, ancestors: Set<object>): boolean => {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === "symbol")) return false;
  if (keys.length !== Object.keys(value).length) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      isDataDescriptor(descriptor) &&
      isJsonDomainValue(descriptor.value, ancestors)
    );
  });
};

const isJsonDomainValue = (value: unknown, ancestors: Set<object>): boolean => {
  if (isJsonPrimitive(value)) return true;
  if (typeof value !== "object" || value === null) return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? isJsonArray(value, ancestors)
    : isJsonRecord(value, ancestors);
  ancestors.delete(value);
  return valid;
};

export const isRoundTrippableForDevtools = (value: unknown): boolean => {
  try {
    return isJsonDomainValue(value, new Set());
  } catch {
    return false;
  }
};

export const stringifyForDevtools = (value: unknown): string => {
  try {
    return JSON.stringify(projectForDisplay(value), null, 2) ?? "undefined";
  } catch (error) {
    return `[Unserializable: ${error instanceof Error ? error.message : String(error)}]`;
  }
};
