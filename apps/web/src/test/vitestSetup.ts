// Zustand persistence adapters are created while modules load. Give every unit-test
// file a real Storage object before those imports run so global stubs can restore a
// valid baseline instead of leaving `localStorage` defined as `undefined`.
function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: createMemoryStorage(),
});
