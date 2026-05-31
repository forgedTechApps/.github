// The file exists but never asserts 403 — a hollow cross-tenant test.
// CROSS_TENANT_TEST_EMPTY stays an error: this is the binary, load-bearing
// signal (routes exist, foreign-tenant rejection is never asserted).
it("does something unrelated", async () => {
  const res = await call({ method: "GET", path: "/org/:orgId/widgets" });
  expect(res.statusCode).toBe(200);
});
