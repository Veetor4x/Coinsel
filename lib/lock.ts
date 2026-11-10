// One filing at a time per key, so two quick identical requests can't both pass the duplicate check.
// In-memory: covers one server instance (enough for this demo; a real deployment would use the chain or a database).
const tails = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (tails.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
  return run;
}
