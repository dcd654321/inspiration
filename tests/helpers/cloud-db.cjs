'use strict';

// 只模拟本项目使用的数据库契约；不代表真实云端事务验收。
function memoryCloudDatabase() {
  let tables = {};
  let pending = Promise.resolve();
  const clone = (x) => structuredClone(x);
  const table = (name) => tables[name] || (tables[name] = []);
  const match = (doc, where) => Object.entries(where).every(([key, value]) =>
    value && value.test ? value.test(doc[key]) : doc[key] === value);
  const operator = (test) => ({ test, and(other) { return operator((x) => test(x) && other.test(x)); } });
  const command = { lt: (v) => operator((x) => x < v), lte: (v) => operator((x) => x <= v),
    gt: (v) => operator((x) => x > v), gte: (v) => operator((x) => x >= v),
    neq: (v) => operator((x) => x !== v), inc: (value) => ({ increment: value }) };
  function collection(name) {
    let filter = {}, max = Infinity, order = null, fields = null;
    function rows() {
      const found = table(name).filter((x) => match(x, filter));
      if (order) found.sort((a, b) => (a[order[0]] < b[order[0]] ? -1 : a[order[0]] > b[order[0]] ? 1 : 0) * (order[1] === 'desc' ? -1 : 1));
      return found.slice(0, max);
    }
    const query = {
      where(value) { filter = value; return query; }, limit(value) { max = value; return query; },
      orderBy(field, direction) { order = [field, direction]; return query; },
      field(value) { fields = value; return query; },
      async get() { return { data: rows().map((row) => fields
        ? Object.fromEntries(Object.keys(fields).map((key) => [key, row[key]])) : clone(row)) }; },
      async count() { return { total: rows().length }; },
      async add({ data }) {
        if (table(name).some((x) => x._id === data._id ||
          (name === 'linggan_shares' && (x.tokenHash === data.tokenHash ||
            x.ownerAccountKey === data.ownerAccountKey && x.requestId === data.requestId)) ||
          (name === 'linggan_feedback' && (x.dedupeKey === data.dedupeKey ||
            x.accountKey === data.accountKey && x.requestId === data.requestId)))) throw Error('DUPLICATE');
        table(name).push(clone(data));
        return { _id: data._id };
      },
      async update({ data }) {
        const found = rows();
        for (const row of found) for (const [key, value] of Object.entries(data)) {
          row[key] = value && typeof value.increment === 'number' ? row[key] + value.increment : clone(value);
        }
        return { stats: { updated: found.length } };
      },
      async remove() {
        const ids = new Set(rows().map((x) => x._id));
        tables[name] = table(name).filter((x) => !ids.has(x._id));
        return { stats: { removed: ids.size } };
      },
      doc(id) {
        return {
          async get() { return { data: clone(table(name).find((x) => x._id === id) || null) }; },
          async set({ data }) {
            const found = table(name).find((x) => x._id === id);
            if (found) tables[name] = table(name).filter((x) => x._id !== id);
            table(name).push(Object.assign({ _id: id }, clone(data)));
          },
          update: (data) => collection(name).where({ _id: id }).update(data)
        };
      }
    };
    return query;
  }
  return {
    collection, command,
    runTransaction(fn) {
      const result = pending.then(async () => {
        const snapshot = clone(tables);
        try { return await fn({ collection }); }
        catch (err) { tables = snapshot; throw err; }
      });
      pending = result.catch(() => {});
      return result;
    },
    rows: (name) => clone(table(name)), seed(name, rows) { tables[name] = clone(rows); }
  };
}
module.exports = { memoryCloudDatabase };
