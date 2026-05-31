// Six tenant-scoped routes but the test only covers two, with no sentinel —
// a genuine under-coverage gap. This must surface as an INFO hint (not warn):
// both sides are heuristic counts, so a low ratio is a prompt to look, not a
// gate. The load-bearing error case is CROSS_TENANT_TEST_EMPTY (issue #33).
export function register(app) {
  app.get("/org/:orgId/widgets", handler);
  app.post("/org/:orgId/widgets", handler);
  app.delete("/org/:orgId/widgets/:id", handler);
  app.get("/org/:orgId/gadgets", handler);
  app.post("/org/:orgId/gadgets", handler);
  app.patch("/org/:orgId/gadgets/:id", handler);
}
function handler() {}
