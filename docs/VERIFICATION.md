# 验证记录

本文件记录每次验证的实际命令与结果。**未执行的项不得写成通过。**

## 2026-09-22 · 工程初始化

范围：仅创建工程骨架与 OpenSpec 提案 `add-inspiration-mvp`。未实现任何业务功能，未部署云函数，未创建云端集合，未启用 AI。

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 依赖安装 | `npm install` | 通过：80 个包，0 个漏洞 |
| 结构检查 | `npm run check` | 通过：`PASS 39 syntax/config/page checks.` |
| 单元测试 | `npm test` | 通过：6 项测试，0 失败 |
| 规范校验 | `npm run openspec -- validate --all --strict` | 通过：1 项通过，0 失败 |
| 变更清点 | `npm run openspec -- list` | `add-inspiration-mvp  0/36 tasks` |

单元测试覆盖的 6 项不变量：云开关为 `false` 且 `envId` 为空；AI 开关为 `false`；资源名统一 `linggan_` 前缀；取值边界在合理范围；`createId` 连续 500 次无重复；小程序包与云函数内不含模型密钥；`app.json` 页面文件齐全且 tabBar 指向有效页面。

版本控制：已在 `dev` 分支建立初始提交 `2933a94`，工作区干净，未配置远端、未推送。

未执行（需独立授权或真机）：

- 云函数部署、集合创建、云存储权限配置。
- AI 真实调用、额度与内容安全验证。
- 微信开发者工具中的 WXML/WXSS 编译与真机渲染。
- 双账户隔离、断网上传、权限拒绝等真机验收。

以上未执行项不等同于失败，也不得在未执行的情况下勾选 `tasks.md` 中对应条目。
