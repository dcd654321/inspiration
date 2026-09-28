// AI 开关：本地适配、额度、安全与降级已实现，真实云端验收前保持关闭。
// 模型密钥只能放云函数环境变量，不得写入小程序包。
// 开启前必须完成：linggan_ai 部署、密钥注入、额度与限流、内容安全过滤、输出契约校验、降级路径真机验证。
const resources = require('./cloud-resources');

module.exports = {
  enabled: false,
  functionName: resources.aiFunction,
  timeoutMs: 55000
};
