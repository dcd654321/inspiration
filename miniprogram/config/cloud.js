// 云环境开关。骨架阶段保持关闭：尚未创建 linggan_* 资源，也未取得部署授权。
// 开启前必须完成：资源创建授权、环境 ID 填写、函数部署、权限规则配置与验收。
const resources = require('./cloud-resources');

module.exports = {
  enabled: false,
  envId: '',
  apiFunction: resources.apiFunction,
  timeoutMs: 10000
};
