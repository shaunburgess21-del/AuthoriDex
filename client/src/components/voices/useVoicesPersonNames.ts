import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Names for celebrity filter chips. Seeds (favourites) win immediately;
 * everyone else is resolved from the existing person detail endpoint.
 */
export function useVoicesPersonNames(ids: readonly string[], seed: Record<string, string>) {
  const [resolved, setResolved] = useState<Record<string, string>>({});

  const remember = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!id || !trimmed) return;
    setResolved((prev) => (prev[id] === trimmed ? prev : { ...prev, [id]: trimmed }));
  }, []);

  const seedKey = useMemo(
    () => Object.entries(seed).map(([id, name]) => `${id}\t${name}`).sort().join("\n"),
    [seed],
  );

  useEffect(() => {
    if (!seedKey) return;
    setResolved((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const row of seedKey.split("\n")) {
        const tab = row.indexOf("\t");
        if (tab < 0) continue;
        const id = row.slice(0, tab);
        const name = row.slice(tab + 1);
        if (!id || !name || next[id] === name) continue;
        next[id] = name;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [seedKey]);

  const missingKey = ids.filter((id) => id && !resolved[id] && !seed[id]).join(",");

  useEffect(() => {
    if (!missingKey) return;
    const missing = missingKey.split(",");
    let cancelled = false;
    void (async () => {
      const found: Array<readonly [string, string]> = [];
      await Promise.all(
        missing.map(async (id) => {
          try {
            const res = await fetch(`/api/trending/${encodeURIComponent(id)}`);
            if (!res.ok) return;
            const json = (await res.json()) as { name?: unknown };
            if (typeof json.name === "string" && json.name.trim()) {
              found.push([id, json.name.trim()]);
            }
          } catch {
            /* chip falls back to a generic label */
          }
        }),
      );
      if (cancelled || found.length === 0) return;
      setResolved((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const [id, name] of found) {
          if (next[id] === name) continue;
          next[id] = name;
          changed = true;
        }
        return changed ? next : prev;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [missingKey]);

  const names = useMemo(() => ({ ...seed, ...resolved }), [seed, resolved]);
  return { names, remember };
}
