import { useEffect, useState } from 'react';

// A useState that mirrors to localStorage — used for UI shell state (active
// section, sidebar collapse) so the app reopens where you left it. SSR-safe and
// quota/parse-error tolerant: any failure falls back to the initial value.
export function usePersisted<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
      return raw != null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore quota / private-mode failures — state still works in-memory */
    }
  }, [key, value]);

  return [value, setValue];
}
