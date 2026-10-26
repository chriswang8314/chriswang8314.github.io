/*
 * The scene loader. Scenes are listed in scenes/index.js with a dynamic
 * import(), so a visitor only downloads the scene they're looking at. Each
 * module is fetched once; asking again returns the same promise. A load can
 * be overtaken by a newer one (a visitor clicking quickly through the
 * gallery): `latest(token)` says whether it's still the one wanted.
 */

export function createLoader(registry) {
  const modules = new Map();
  let token = 0;

  return {
    registry,
    has: (id) => registry.some((s) => s.id === id),
    entry: (id) => registry.find((s) => s.id === id),

    // the scene's definition (fetched once)
    module(id) {
      const entry = registry.find((s) => s.id === id);
      if (!entry) return Promise.reject(new Error(`No scene called "${id}"`));
      if (!modules.has(id)) modules.set(id, entry.load().then((m) => m.default));
      return modules.get(id);
    },

    // resolves to [scene definition, token], for the scene to show next
    async load(id) {
      const mine = ++token;
      return [await this.module(id), mine];
    },

    latest: (t) => t === token,
  };
}
