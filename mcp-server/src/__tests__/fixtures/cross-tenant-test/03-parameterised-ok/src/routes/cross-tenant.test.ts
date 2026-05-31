// Parameterised cross-tenant test: one loop, one literal 403 check covering
// every row, grounded by an EXPECTED_ROUTE_COUNT = ROUTES.length sentinel.
// This is the shape the #33 fix must score correctly (not "1 assertion").
const ROUTES = [
  { method: "GET", path: "/org/:orgId/widgets" },
  { method: "POST", path: "/org/:orgId/widgets" },
  { method: "DELETE", path: "/org/:orgId/widgets/:id" },
];

it("returns 403 for a foreign orgId on every route", async () => {
  for (const route of ROUTES) {
    const res = await call(route);
    if (res.statusCode !== 403) {
      throw new Error(`${route.method} ${route.path} → ${res.statusCode}`);
    }
  }
  const EXPECTED_ROUTE_COUNT = ROUTES.length;
  expect(EXPECTED_ROUTE_COUNT).toBeGreaterThanOrEqual(3);
});
