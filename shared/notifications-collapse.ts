/**
 * Inbox collapse semantics shared by the client list UI and server
 * unread-count API. Rows with the same non-null groupKey count as one
 * visible row; rows without a groupKey count individually.
 */
export interface CollapsibleNotificationRow {
  id: string;
  groupKey: string | null;
}

export function countCollapsedNotifications(
  rows: ReadonlyArray<CollapsibleNotificationRow>,
): number {
  const keys = new Set<string>();
  for (const row of rows) {
    keys.add(row.groupKey ?? row.id);
  }
  return keys.size;
}
