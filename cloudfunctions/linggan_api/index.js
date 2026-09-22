// 骨架占位：linggan_api 云函数入口，尚未部署、尚未实现任何业务动作。
// 实施见 openspec/changes/add-inspiration-mvp/tasks.md 第 6 节。
// 约定：身份只来自微信云函数可信上下文，不接受客户端传入的 AppID / OpenID。
exports.main = async () => ({
  ok: false,
  code: 'NOT_IMPLEMENTED',
  message: '灵感记录云函数尚未实现，当前仅为工程骨架。'
});
