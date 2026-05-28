export async function getUser(db: { query: (s: string) => Promise<unknown> }, id: string) {
  return db.query(`SELECT * FROM users WHERE id = ${id}`);
}
