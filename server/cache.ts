// Small TTL cache, saved to .cache/<name>.json so restarts don't use up paid API searches.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', '.cache');

export function createCache<T>(name: string, ttlMs: number, maxEntries = 2000) {
  const file = join(DIR, `${name}.json`);
  let entries = new Map<string, { at: number; value: T }>();
  try {
    entries = new Map(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    /* no cache yet */
  }

  let timer: NodeJS.Timeout | undefined;
  function persist() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        mkdirSync(DIR, { recursive: true });
        writeFileSync(file, JSON.stringify([...entries]));
      } catch (err) {
        console.warn(`cache ${name}: could not save`, err);
      }
    }, 500);
  }

  return {
    get(key: string): T | undefined {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (Date.now() - hit.at > ttlMs) {
        entries.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key: string, value: T) {
      entries.delete(key);
      entries.set(key, { at: Date.now(), value });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
      persist();
    },
  };
}
