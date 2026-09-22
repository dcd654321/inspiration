// 云环境开关。
//
// **环境 ID 已填，但 enabled 仍为 false**——这不是漏改，是有意的。
//
// 翻开关之前必须先在云开发控制台把资源建出来、把函数部署上去（清单见
// docs/DEPLOYMENT.md）。否则应用每次保存都会去调一个不存在的云函数：
// 界面仍能用（降级成「已保存。还没同步到云端」），但日志里会一直报错，
// 而真正的失败原因被那条降级提示盖住了。
//
// 顺序不能反：**先部署、再翻开关**。
const resources = require('./cloud-resources');

module.exports = {
  enabled: false,
  envId: 'cloud1-d6g4hu8txdd86e48c',
  apiFunction: resources.apiFunction,
  timeoutMs: 10000
};
