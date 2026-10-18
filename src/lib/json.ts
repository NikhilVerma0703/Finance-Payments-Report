/**
 * The extracted payloads are stored as JSON text so the database stays a plain
 * SQLite file with no server-specific column types. These two helpers are the
 * only place that knows that.
 */
export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function fromJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}
