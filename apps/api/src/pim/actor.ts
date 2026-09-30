/** Who performed an action, for audit events: the authenticated user's email, else id. */
export function actorOf(user: unknown): string {
  const u = (user ?? {}) as { email?: unknown; id?: unknown };
  if (typeof u.email === 'string' && u.email) return u.email;
  if (typeof u.id === 'string' && u.id) return u.id;
  return 'unknown';
}
