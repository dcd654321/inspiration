// 2026-10-02 用户授权开放客户端 AI 入口；服务端独立核验模型、审核和额度。
// 模型密钥只能放云函数环境变量，不得写入小程序包。
// 平台使用云开发身份，无前端密钥。远端未配置时失败关闭，不生成本地替代结果。
const resources = require('./cloud-resources');

module.exports = {
  enabled: true,
  functionName: resources.aiFunction,
  timeoutMs: 55000
};
