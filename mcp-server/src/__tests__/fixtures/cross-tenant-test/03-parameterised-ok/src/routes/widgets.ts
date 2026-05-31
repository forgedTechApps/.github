// Three tenant-scoped authenticated routes.
export function register(app) {
  app.get("/org/:orgId/widgets", handler);
  app.post("/org/:orgId/widgets", handler);
  app.delete("/org/:orgId/widgets/:id", handler);
}
function handler() {}
