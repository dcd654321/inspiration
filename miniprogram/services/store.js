'use strict';
// 本机状态与持久化。
//
// 两条约束：
//   1. **不直接依赖 wx。** 存储与网络都从外面注入（`storage` / `transport`）。
//      离线、配额耗尽、同步失败这些降级路径，靠这一条才能在 Node 里直接测——
//      真机上很难稳定复现，而它们恰恰是规范里占了一半的场景。
//   2. **时间由调用方注入**，与 core/ 同样。内部不调用 Date.now()。
//
// 本机不是数据来源，只是缓存（见 docs/detailed-design.md §3.6）。它存在的理由是：
// 让用户刚写下的内容在网络中断时也不丢，并让浏览不必等网络。

const { byUpdatedAtDesc, isDeleted, isMerged, markDeleted } = require('../core/inspiration');

// key 带版本号：将来必须改布局时，靠它识别并做一次性迁移，而不是去猜旧格式。
const STORAGE_KEYS = {
  snapshot: 'linggan:v1:snapshot',
  queue: 'linggan:v1:queue'
};

const OP_KIND = {
  upsert: 'inspiration.upsert'
};

/** 完全没存过东西时的初始快照。读不出来也退回这个，不让应用因为一条坏数据起不来。 */
function emptySnapshot() {
  return { generation: 1, version: 0, syncedAt: 0, inspirations: [] };
}

function readJSON(storage, key, fallback) {
  let raw;
  try {
    raw = storage.get(key);
  } catch (err) {
    return fallback;
  }
  if (raw === undefined || raw === null) return fallback;
  // 注入的 storage 若已经反序列化过（测试替身），直接用；否则按字符串解析。
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function createStore(options) {
  const opts = options || {};
  const storage = opts.storage;
  const transport = opts.transport || null;
  const now = opts.now;

  if (!storage) throw new Error('createStore 需要一个 storage');
  if (typeof now !== 'function') throw new Error('createStore 需要一个 now() 函数——时间必须由调用方注入');

  function readSnapshot() {
    const snapshot = readJSON(storage, STORAGE_KEYS.snapshot, null);
    if (!snapshot || !Array.isArray(snapshot.inspirations)) return emptySnapshot();
    return snapshot;
  }

  /** 写快照。存储写失败（配额耗尽）时**抛出**，由调用方决定怎么向用户交代。 */
  function writeSnapshot(snapshot) {
    storage.set(STORAGE_KEYS.snapshot, snapshot);
    return snapshot;
  }

  function readQueue() {
    const queue = readJSON(storage, STORAGE_KEYS.queue, null);
    return Array.isArray(queue) ? queue : [];
  }

  function writeQueue(queue) {
    storage.set(STORAGE_KEYS.queue, queue);
    return queue;
  }

  /**
   * 入队一个待同步操作。
   *
   * **按 id 幂等**：同一个 id 重复入队只保留一条，内容以最后一次为准。
   * 这是「同一次保存因重试被提交多次，只产生一条业务记录」在本机的落点——
   * 失败后反复重试不会把队列撑成一串重复项。
   */
  function enqueue(op) {
    const queue = readQueue();
    const enqueuedAt = now();
    const entry = {
      id: op.id,
      kind: op.kind,
      payload: op.payload,
      enqueuedAt,
      // 请求标识在**入队时**定下来并随队列持久化。将来的重试循环再发同一条队列项时，
      // 用的是同一个 requestId，服务端的传输层幂等才成立。
      requestId: 'req_' + op.id + '_' + enqueuedAt
    };
    const index = queue.findIndex((item) => item.id === op.id);
    const next = index === -1
      ? queue.concat([entry])
      : queue.map((item, i) => (i === index ? entry : item));

    return { queue: writeQueue(next), requestId: entry.requestId, enqueuedAt };
  }

  function dequeue(opId) {
    return writeQueue(readQueue().filter((item) => item.id !== opId));
  }

  function clearQueue() {
    return writeQueue([]);
  }

  /**
   * 保存一条灵感。这是**唯一**的保存入口——保存与同步是一个动作，不是两步。
   *
   * 执行顺序是刻意的：
   *   1. 先落本机。网络断了也不丢用户刚写下的内容。
   *   2. 再入队。**入队必须早于发起同步**——否则同步途中崩溃，这条意图就丢了，
   *      用户会以为已经保存，而云端和队列里都没有它。
   *   3. 发起同步。成功才出队。
   *
   * 返回值的三种形态，分别对应界面上的三种呈现（见 docs/ui-design.md 第 2 节）：
   *   { ok: true,  synced: true }              —— 已保存
   *   { ok: true,  synced: false, code }       —— 已保存，还没同步到云端，会自动重试
   *   { ok: false, code: 'LOCAL_WRITE_FAILED' }—— 没存下来，界面必须保留用户输入
   */
  async function saveInspiration(inspiration) {
    const snapshot = readSnapshot();
    const index = snapshot.inspirations.findIndex((item) => item.id === inspiration.id);
    const inspirations = index === -1
      ? snapshot.inspirations.concat([inspiration])
      : snapshot.inspirations.map((item, i) => (i === index ? inspiration : item));

    try {
      writeSnapshot(Object.assign({}, snapshot, { inspirations }));
    } catch (err) {
      // 本机都写不进去，就不要去打扰云端——下游没有任何东西可同步。
      return { ok: false, code: 'LOCAL_WRITE_FAILED', cause: err };
    }

    // 云未启用：跳过同步。这不是「降级」，是同一个动作在没有云端时的自然结果，
    // 界面看到的仍然是「已保存」，不需要任何差别处理。
    if (!transport) {
      return { ok: true, synced: true };
    }

    const op = {
      id: 'op_' + inspiration.id,
      kind: OP_KIND.upsert,
      payload: { inspiration }
    };

    let queued;
    try {
      queued = enqueue(op);
    } catch (err) {
      // 队列写不进去不影响这次保存本身：内容已经在本机快照里了。
      return { ok: true, synced: false, code: 'QUEUE_WRITE_FAILED', cause: err };
    }

    let response;
    try {
      response = await transport.send('snapshot.push', {
        generation: snapshot.generation,
        upserts: [inspiration]
      }, { requestId: queued.requestId });
    } catch (err) {
      return { ok: true, synced: false, code: 'NETWORK', cause: err };
    }

    if (!response || response.ok !== true) {
      return { ok: true, synced: false, code: (response && response.code) || 'INTERNAL' };
    }

    dequeue(op.id);

    const latest = readSnapshot();
    try {
      writeSnapshot(Object.assign({}, latest, {
        version: (response.data && response.data.version) || latest.version,
        syncedAt: now()
      }));
    } catch (err) {
      // 版本号没写成不影响这次保存：内容已经在本机，下次同步会纠正。
    }

    return { ok: true, synced: true };
  }

  /**
   * 删除一条灵感。
   *
   * 顺序是**先软删、再确认、最后物理移除**（见 detailed-design §5.2）：
   * 云端确认失败时保持本机数据不动，用户不会遇到「本机删了、云端还在」。
   * 云未启用时没有确认这一步，直接完成——与保存是同一条取舍（§3.4）。
   *
   * 不改变 updatedAt：删除不是编辑，不该让条目在列表里重新排序。
   */
  async function deleteInspiration(id) {
    const found = readSnapshot().inspirations.find((item) => item.id === id);
    if (!found) return { ok: false, code: 'NOT_FOUND' };

    const marked = markDeleted(found, { now: now() });
    const result = await saveInspiration(marked);

    if (!result.ok) return result;
    if (!result.synced) {
      // 还没同步到云端：本机保留软删标记，等重试成功后由下一次删除收尾
      return result;
    }

    const latest = readSnapshot();
    try {
      writeSnapshot(Object.assign({}, latest, {
        inspirations: latest.inspirations.filter((item) => item.id !== id)
      }));
    } catch (err) {
      // 物理移除失败不影响「已删除」这个结论：软删标记还在，列表已经不会显示它了。
    }

    return { ok: true, synced: true };
  }

  /**
   * 列表默认展示的内容：排除已删除与已合并的，按最近更新时间倒序。
   * 已合并的灵感另有入口可见、可恢复——**默认隐藏 + 没有入口 = 删除**。
   */
  function listInspirations() {
    return readSnapshot().inspirations
      .filter((item) => !isDeleted(item) && !isMerged(item))
      .sort(byUpdatedAtDesc);
  }

  function getInspiration(id) {
    const found = readSnapshot().inspirations.find((item) => item.id === id);
    return found || null;
  }

  return {
    readSnapshot,
    writeSnapshot,
    readQueue,
    writeQueue,
    enqueue,
    dequeue,
    clearQueue,
    saveInspiration,
    deleteInspiration,
    listInspirations,
    getInspiration
  };
}

module.exports = { createStore, STORAGE_KEYS, OP_KIND, emptySnapshot };
