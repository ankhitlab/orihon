import { useLayoutEffect, useRef, type DependencyList } from "react";

/**
 * Run `apply` when deps change, skipping the first paint after the host instance
 * appears (create-time options already came from the constructor snapshot).
 * When `host` is null the effect is a no-op.
 */
export function useSyncedProp(
  host: object | null | undefined,
  apply: () => void,
  deps: DependencyList
): void {
  const skip = useRef(true);
  const hostRef = useRef(host);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useLayoutEffect(() => {
    if (hostRef.current !== host) {
      hostRef.current = host;
      skip.current = true;
    }
    if (!host) return;
    if (skip.current) {
      skip.current = false;
      return;
    }
    applyRef.current();
    // deps is the caller's prop matrix; apply is read from a ref.
  }, [host, ...deps]);
}

/** Shallow equality for small option bags (behaviors, appearance). */
export function shallowEqual(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}
