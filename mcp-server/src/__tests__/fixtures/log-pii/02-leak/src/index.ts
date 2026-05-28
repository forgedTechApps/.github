export function handle(user: { email: string; password: string }) {
  console.log("login attempt", { email: user.email, password: user.password });
}
