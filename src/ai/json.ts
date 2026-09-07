import { AIError } from "./errors.js";
import type { AIErrorCode } from "./types.js";

export type JSONObject = Record<string, unknown>;

/**
 * Structural JSON deep copy shared by every AI module.
 *
 * Values `JSON.stringify` cannot represent (`undefined`, functions, symbols)
 * become `undefined` instead of throwing, matching how the same values behave
 * inside a cloned object.
 */
export function clone<T>(value: T): T {
  const json = JSON.stringify(value);
  return json === undefined ? (undefined as T) : (JSON.parse(json) as T);
}

export function fail(code: AIErrorCode, path: string, message: string, received?: unknown): never {
  throw new AIError(code, path, message, received);
}

/** Lenient object narrowing for untrusted agent payloads. */
export function record(
  value: unknown,
  path: string,
  code: AIErrorCode = "INVALID_TYPE",
  message = "Expected an object"
): JSONObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, path, message, value);
  return value as JSONObject;
}

/** Strict object narrowing: rejects class instances and other non-plain objects. */
export function plainObject(value: unknown, path: string): JSONObject {
  const result = record(value, path);
  const prototype = Object.getPrototypeOf(result);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("NOT_JSON", path, "Expected a plain JSON object", value);
  }
  return result;
}

/** Reject properties outside the allowed set. */
export function keys(value: JSONObject, allowed: readonly string[], path: string): void {
  const set = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!set.has(key)) fail("UNKNOWN_PROPERTY", `${path}.${key}`, `Unknown property "${key}"`, value[key]);
  }
}

export function requiredProperty(value: JSONObject, key: string, path: string): unknown {
  if (!(key in value)) fail("REQUIRED_PROPERTY", `${path}.${key}`, `Required property "${key}" is missing`);
  return value[key];
}
