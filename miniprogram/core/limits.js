// 共享的取值边界。领域校验逻辑见 core/inspiration.js 与 core/ai-contract.js。
const LIMITS = {
  textMaxLength: 2000,
  supplementMaxLength: 1000,
  photoMaxBytes: 2 * 1024 * 1024,
  photosPerInspiration: 9,
  heatMin: 0,
  heatMax: 100,

  // 标识长度上限。标识会参与云存储路径拼接（linggan/{accountKey}/{id}/{photoId}），
  // 因此必须有明确字符集与长度约束，详见 core/inspiration.js 的 ID_PATTERN。
  idMaxLength: 64,

  // 正文短于此长度时不请求 AI 扩展：内容过短只会得到空洞的草案，
  // 且按规范不得消耗生成额度。阈值可评审后调整。
  aiMinTextLength: 8,

  // AI 草案契约：三个分区各自允许的条目数与单条长度。
  draftSectionMinItems: 1,
  draftSectionMaxItems: 5,
  draftItemMaxLength: 200
};

// 灵感、补充、图片记录都使用客户端生成的稳定标识作为幂等键。
function createId(prefix) {
  const rand = Math.random().toString(36).slice(2, 10);
  return (prefix ? prefix + '_' : '') + Date.now().toString(36) + '_' + rand;
}

module.exports = { LIMITS, createId };
