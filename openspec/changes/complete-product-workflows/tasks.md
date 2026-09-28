# Tasks

- [x] 0. 当前开发基线已提交到本地 dev：`ebb243a`；不含本机配置。
- [x] 1. 本地实现分享/反馈原子配额、访问限流、幂等与撤销释放额度。`production-readiness.test.cjs` 注入式并发通过；真实数据库待任务 10。
- [x] 2. 本地实现保留期清理服务、默认演练入口、条件清理和失败可重试测试。未执行真实清理。
- [x] 3. 搜索、最小筛选、每日回顾及用途模板，保护用户编辑。`discovery.test.cjs` 通过；真实界面待任务 9。
- [x] 4. 标签、阶段及自愿设备统计，本地字段和隐私边界见数据库 §12/15。`ai-workflows.test.cjs`、`usage-metrics.test.cjs` 通过。
- [x] 5. 照片上传编排、页面、重试、私有预览与可恢复删除任务。`photo-workflows.test.cjs` 通过，私有预览使用内置样例图渲染；真实文件/相机另验。
- [x] 6. AI 云开发 SDK 适配器、账户额度与双向审核、权限声明。`ai-workflows.test.cjs`、`record-validation.test.cjs` 通过；未启用或调用真实模型。
- [x] 7. AI 草案选择/编辑/采纳、两种汇总、目标确认与来源恢复。页面协议测试通过，合成预览已渲染；真机与真实模型另验。
- [x] 8. 旧 upsert/delete 队列兼容、照片冲突恢复及会话守卫。`store.test.cjs`、`app-account.test.cjs`、`photo-workflows.test.cjs` 通过；未做旧客户端发布。
- [x] 9.1 本地验证：334 项测试、195 项结构检查、5 项 OpenSpec 严格校验通过；36 个云函数副本一致，`git diff --check` 通过。
- [x] 9.2 离线样例 WXML/WXSS 编译通过；列表、详情、整理、AI 合成预览及照片查看截图已检查。过程与边界见 `docs/VERIFICATION.md`。
- [ ] 9.3 真机键盘、大字号、读屏、弱网及真实平台完整链路验收。
- [ ] 10. 需单独授权/外部条件：云部署、正式数据清理、AI 真实调用、双账户及真机验收、会员商业规则。
