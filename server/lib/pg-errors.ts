/**
 * Postgres error introspection that survives Drizzle's error wrapping.
 *
 * drizzle-orm >= 0.44 wraps driver errors in `DrizzleQueryError`, moving
 * the pg `DatabaseError` (with `.code` / `.constraint`) onto `.cause`.
 * Older code that checks `err.code === "23505"` directly silently stops
 * matching after that upgrade and turns graceful conflict handling into
 * 500s. These helpers check both shapes (and one extra nesting level for
 * safety) so callers don't need to care which version threw.
 */

interface PgErrorFields {
  code?: string;
  constraint?: string;
}

function extractPgError(err: unknown): PgErrorFields | null {
  let current: unknown = err;
  for (let depth = 0; depth < 3 && current; depth++) {
    if (typeof current === "object") {
      const candidate = current as Record<string, unknown>;
      if (typeof candidate.code === "string") {
        return {
          code: candidate.code,
          constraint:
            typeof candidate.constraint === "string" ? candidate.constraint : undefined,
        };
      }
      current = candidate.cause;
    } else {
      break;
    }
  }
  return null;
}

/** True when the error (or its cause chain) is a Postgres unique violation. */
export function isUniqueViolation(err: unknown): boolean {
  return extractPgError(err)?.code === "23505";
}

/** Constraint/index name of a Postgres error, or "" when unavailable. */
export function pgConstraintName(err: unknown): string {
  return extractPgError(err)?.constraint ?? "";
}
