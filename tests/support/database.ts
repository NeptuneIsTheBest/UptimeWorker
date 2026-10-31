// Miniflare bindings are RPC proxies. Wrap them rather than replacing their methods.
export function wrapDatabase(
  db: D1Database,
  overrides: Partial<Pick<D1Database, 'prepare' | 'batch'>>,
): D1Database {
  return new Proxy(db, {
    get(target, key) {
      const value = Reflect.get(overrides, key) ?? Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
