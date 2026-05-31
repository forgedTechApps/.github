// Two tenant-scoped authenticated routes — but the designated test asserts
// no 403 at all (see cross-tenant.test.ts), which must be a hard error.
export function register(app) {
  app.get("/org/:orgId/widgets", handler);
  app.post("/org/:orgId/widgets", handler);
}
function handler() {}
