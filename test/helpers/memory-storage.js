// In-memory stand-in for chrome.storage.local (promise-based get/set/remove).
function createMemoryStorage({ latencyMs = 0, initial = {} } = {}) {
  const data = JSON.parse(JSON.stringify(initial));
  const delay = () => new Promise((r) => setTimeout(r, latencyMs));
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  return {
    async get(keys) {
      await delay();
      if (keys === null || keys === undefined) return clone(data);
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (k in data) out[k] = clone(data[k]);
      return out;
    },
    async set(obj) {
      await delay();
      for (const [k, v] of Object.entries(obj)) data[k] = clone(v);
    },
    async remove(keys) {
      await delay();
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
  };
}

module.exports = { createMemoryStorage };
