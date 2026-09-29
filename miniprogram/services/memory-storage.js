'use strict';
function createMemoryStorage() {
  const values = new Map();
  return { get: (key) => values.get(key), set: (key, value) => values.set(key, value), remove: (key) => values.delete(key) };
}
module.exports = { createMemoryStorage };
