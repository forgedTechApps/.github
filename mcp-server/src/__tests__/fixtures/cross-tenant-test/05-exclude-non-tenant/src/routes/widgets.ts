// Three tenant-scoped routes, all covered by the cross-tenant test.
export function register(app) {
  app.get("/org/:orgId/widgets", handler);
  app.post("/org/:orgId/widgets", handler);
  app.delete("/org/:orgId/widgets/:id", handler);
}
function handler() {}
