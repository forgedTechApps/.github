// Only two explicit 403 assertions for six routes, no parameterised sentinel.
// Ratio 2/6 = 0.33 < 0.80 → CROSS_TENANT_TEST_UNDER_COVERAGE, but at INFO.
it("rejects foreign orgId on widgets GET", async () => {
  const res = await call({ method: "GET", path: "/org/:orgId/widgets" });
  expect(res.statusCode).toBe(403);
});

it("rejects foreign orgId on widgets POST", async () => {
  const res = await call({ method: "POST", path: "/org/:orgId/widgets" });
  expect(res.statusCode).toBe(403);
});
