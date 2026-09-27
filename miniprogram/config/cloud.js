// 云环境开关。
//
// ⚠️ 翻成 true 之后，应用每次保存都会经 `linggan_api` 云函数同步到 `linggan_accounts`
// 集合。**这两样必须在云开发控制台里先建出来**，否则保存会一律降级成
// 「已保存。还没同步到云端，会自动重试」——界面不会坏，但那条提示会一直在。
//
// 所以：如果打开后每条都显示「还没同步」，第一件事是去控制台确认函数有没有部署、
// 集合有没有创建（清单见 docs/DEPLOYMENT.md），而不是去查客户端代码。
//
// 回滚很简单：改回 false 重新编译即可，不影响云端数据。
const resources = require('./cloud-resources');

module.exports = {
  enabled: true,
  envId: 'cloud1-d6g4hu8txdd86e48c',
  apiFunction: resources.apiFunction,
  timeoutMs: 10000
};
