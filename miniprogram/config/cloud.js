// 目标按运行版本解析：开发版/体验版连共享测试环境，正式版连共享正式环境（资源方 weddingTodo）。
// 云是唯一数据源。函数、集合或网络不可用时保存失败并保留输入，不产生设备持久副本或离线队列。
// enabled=false 会停止云连接及保存，不会切换为本机保存模式。
// Node（测试）里没有 wx，按 develop 解析；release 目标与 deployment/product/manifest.json 一致，测试拦截漂移。
const resources = require('./cloud-resources');

const TARGETS = Object.freeze({
  test: Object.freeze({
    enabled: true,
    envId: 'cloud1-d8gopnalv908bb47a',
    resourceAppid: 'wx7ad85943fe81e095',
    apiFunction: resources.apiFunction,
    timeoutMs: 10000
  }),
  product: Object.freeze({
    enabled: true,
    envId: 'product-d2g59zty74d7d1ec1',
    resourceAppid: 'wx7ad85943fe81e095',
    apiFunction: resources.apiFunction,
    timeoutMs: 10000
  })
});

function resolveCloudConfig(envVersion = 'develop') {
  return envVersion === 'release' ? TARGETS.product : TARGETS.test;
}

function currentEnvVersion() {
  try {
    const info = typeof wx !== 'undefined' && typeof wx.getAccountInfoSync === 'function'
      ? wx.getAccountInfoSync()
      : null;
    const version = info && info.miniProgram && info.miniProgram.envVersion;
    return typeof version === 'string' && version ? version : 'develop';
  } catch (_) {
    return 'develop';
  }
}

module.exports = { ...resolveCloudConfig(currentEnvVersion()), TARGETS, resolveCloudConfig };
