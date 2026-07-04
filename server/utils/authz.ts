export function resolveProfileRole(role?: string | null): string {
  return role || "user";
}

export function isAdminRole(role?: string | null): boolean {
  return resolveProfileRole(role) === "admin";
}

export function isStaffRole(role?: string | null): boolean {
  const r = resolveProfileRole(role);
  return r === "admin" || r === "moderator";
}
