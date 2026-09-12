export function isJsonSerializable(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;

  const enumerableKeys = Object.keys(value);
  const ownKeys = Reflect.ownKeys(value);
  if (Array.isArray(value)) {
    if (ownKeys.length !== enumerableKeys.length + 1 || ownKeys.at(-1) !== "length" ||
        enumerableKeys.length !== value.length || enumerableKeys.some((key, index) => key !== String(index))) return false;
  } else if (ownKeys.length !== enumerableKeys.length) {
    return false;
  }

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonSerializable(item, ancestors))
    : Object.values(value).every((item) => isJsonSerializable(item, ancestors));
  ancestors.delete(value);
  return valid;
}
