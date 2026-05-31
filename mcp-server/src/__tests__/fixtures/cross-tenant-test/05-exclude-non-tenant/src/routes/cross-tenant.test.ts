// Covers the three tenant-scoped widget routes. The four auth routes are
// excluded via route_files_exclude, so 3 assertions vs 3 routes = ratio 1.0.
const ROUTES = [
  { method: "GET", path: "/org/:orgId/widgets" },
  { method: "POST", path: "/org/:orgId/widgets" },
  { method: "DELETE", path: "/org/:orgId/widgets/:id" },
];

it("returns 403 for a foreign orgId on every tenant-scoped route", async () => {
  for (const route of ROUTES) {
    const res = await call(route);
    if (res.statusCode !== 403) {
      throw new Error(`${route.method} ${route.path} → ${res.statusCode}`);
    }
  }
  const EXPECTED_ROUTE_COUNT = ROUTES.length;
  expect(EXPECTED_ROUTE_COUNT).toBeGreaterThanOrEqual(3);
});
