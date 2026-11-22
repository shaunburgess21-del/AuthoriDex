/** Routes where the shared footer is suppressed. */
export function shouldHideFooter(pathname: string): boolean {
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return true;
  if (pathname.startsWith("/predict/updown/")) return true;
  if (pathname.startsWith("/predict/h2h/")) return true;
  if (pathname.startsWith("/predict/race/")) return true;
  return false;
}
