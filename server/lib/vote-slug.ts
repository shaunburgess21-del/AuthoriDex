import { eq, inArray, type Column } from "drizzle-orm";
import { voteSlugLookupValues } from "@shared/vote-slug-redirects";

/** Match a poll slug plus any typo aliases from VOTE_SLUG_REDIRECTS. */
export function voteSlugIn<T extends Column>(column: T, slug: string) {
  const values = voteSlugLookupValues(slug);
  if (values.length <= 1) return eq(column, values[0] ?? slug);
  return inArray(column, values);
}
