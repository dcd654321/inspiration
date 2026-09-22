// 骨架阶段共享的取值边界。业务校验逻辑在 add-inspiration-mvp 实施阶段实现。
const LIMITS = {
  textMaxLength: 2000,
  supplementMaxLength: 1000,
  photoMaxBytes: 2 * 1024 * 1024,
  photosPerInspiration: 9,
  heatMin: 0,
  heatMax: 100
};

// 灵感、补充、图片记录都使用客户端生成的稳定标识作为幂等键。
function createId(prefix) {
  const rand = Math.random().toString(36).slice(2, 10);
  return (prefix ? prefix + '_' : '') + Date.now().toString(36) + '_' + rand;
}

module.exports = { LIMITS, createId };
