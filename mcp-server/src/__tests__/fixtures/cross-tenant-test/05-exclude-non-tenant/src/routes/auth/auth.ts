// Pre-tenant-context auth routes — NOT org-scoped, so they must not inflate
// the cross-tenant denominator. Without route_files_exclude these 4 handlers
// would push the ratio under threshold and produce a false UNDER_COVERAGE.
export function register(app) {
  app.post("/auth/login", handler);
  app.post("/auth/passkey/register", handler);
  app.post("/auth/magic-link", handler);
  app.get("/auth/session", handler);
}
function handler() {}
