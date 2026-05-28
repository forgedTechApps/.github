export async function getUser(db: { query: (s: string, p: unknown[]) => Promise<unknown> }, id: string) {
  return db.query("SELECT * FROM users WHERE id = $1", [id]);
}
