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

## 2026-09-22 · 安装 OpenSpec skills

范围：仅安装 OpenSpec 的 AI 工具集成文件，未改动任何业务代码、提案内容或云配置。

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 初始化 | `npm run openspec -- init --tools claude --no-animation` | 通过：生成 6 个 skill 与 6 个命令于 `.claude/` |
| 配置完整性 | `md5sum openspec/config.yaml` | 前后一致（`fe6db47b…`），自定义 context 与 rules 未被覆盖 |
| 变更范围 | `git status --short` | 仅新增 `.claude/`，既有提案文件零改动 |
| 结构检查 | `npm run check` | 通过：`PASS 39 syntax/config/page checks.` |
| 单元测试 | `npm test` | 通过：6 项测试，0 失败 |
| 规范校验 | `npm run openspec -- validate --all --strict` | 通过：1 项通过，0 失败 |

生成的 skill：`openspec-propose`、`openspec-apply-change`、`openspec-archive-change`、`openspec-explore`、`openspec-sync-specs`、`openspec-update-change`。对应命令：`/opsx:propose`、`/opsx:apply`、`/opsx:archive`、`/opsx:explore`、`/opsx:sync`、`/opsx:update`。

提交 `ecb65b9`。**未验证项**：项目级 `.claude/skills/` 是否被当前客户端加载、skill 是否按预期自动触发，需在新会话中确认；在此之前不得把「自动走 OpenSpec」当作已生效事实。

## 2026-09-22 · 补充详细设计与界面设计，记录热度暂缓

范围：仅新增两份文档、调整 OpenSpec 提案中与热度相关的表述。**未改动任何 JS / JSON 业务代码，未实现任何功能，未部署，未启用云或 AI。**

产出：

| 文件 | 说明 |
| --- | --- |
| `docs/detailed-design.md` | 云函数协议与动作表、错误码总表、数据结构、三类状态机、AI 契约与降级、core 模块签名、幂等与冲突、实施前待拍板项 |
| `docs/ui-design.md` | 四个页面的区块与元素、空态/加载态/失败态、文案与合规红线、需移除的骨架内容 |

热度暂缓的落点：`proposal.md`（What Changes 末条、Capabilities、Impact、验收成功标准）、`tasks.md`（新增第 10 节「暂缓」，1.3 与 3.2 相应调整）、`design.md`（「热度设计」加暂缓标注、`heat` 字段标注为不写入）、`specs/inspiration-capture/spec.md`（详情页描述去掉热度）、`openspec/config.yaml`（能力计数由四项改为三项）。`specs/inspiration-heat/spec.md` 原样保留、未删除。

### 本次验证未执行（环境阻塞）

本会话中三条常规验证命令**均无法执行**，原因是 PATH 上只有一个 Node 版本，低于 `package.json` 要求的 `>=20.19.0`：

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 运行环境 | `node --version` | `v12.22.12`（`E:\nodejs`）；`npm --version` 为 `6.14.16` |
| 单元测试 | `npm test` | **未通过**：`node: bad option: --test`（`node --test` 需 Node 18+） |
| 结构检查 | `npm run check` | **未通过**：`Error: Cannot find module 'node:fs'`（`check.cjs` 使用 `node:` 前缀，需 Node 14.18+） |
| 规范校验 | `npm run openspec -- validate --all --strict` | **未执行**：`scripts/openspec.cjs` 同样因 `Cannot find module 'node:path'` 提前退出 |

已在 `C:\Program Files\nodejs`、`%LOCALAPPDATA%\Programs`、`%APPDATA%\nvm`、各盘符根目录及常见工具目录中查找更新的 Node，均未找到；`wsl -l -q` 只有 `docker-desktop`，无可用 Linux 发行版。

**需要确认**：本文件前两条记录（工程初始化、安装 OpenSpec skills）均记有 `npm test`、`npm run check`、`npm run openspec -- validate` 通过，且 `package-lock.json` 的 `lockfileVersion` 为 `3`（由 npm 7+ 生成），说明当时确有 Node 20+ 可用。当前环境与之不一致，请确认是否 Node 被降级或 PATH 发生变化。**在 Node 升级到 20.19.0 之前，本仓库的全部自动化验证都无法执行**，本次改动也因此未经自动校验，不得据此判定通过。

未执行项不等同于失败，也不得在未执行的情况下勾选 `tasks.md` 中对应条目。

## 2026-09-22 · 升级 Node 并补跑被阻塞的验证

背景：上一节记录的三条验证因环境中只有 Node v12.22.12 而无法执行。本次升级 Node 后全部补跑，环境阻塞已解除。

### 环境变更

| 项目 | 变更前 | 变更后 |
| --- | --- | --- |
| Node | v12.22.12 | v24.21.0（当前 LTS） |
| npm | 6.14.16 | 11.19.0 |
| 安装位置 | `E:\nodejs` | `E:\nodejs`（路径不变） |
| 旧版本去向 | —— | 完整保留在 `E:\nodejs-v12-backup`，可回退 |

Node 24 取自官方 `node-v24.21.0-win-x64.zip`。`E:\nodejs\` 原目录的 ACL 未给当前用户写权限（仅 `SYSTEM` 与 `Administrators` 有完全控制），因此「改名」这一步由用户在管理员终端执行，其余（下载、解压、放置、校验）由本次会话完成。`E:\nodejs\` 仍是系统级 PATH 的条目标，路径未变动，无需改环境变量。

### 补跑的验证

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 运行环境 | `node --version` / `npm --version` | `v24.21.0` / `11.19.0` |
| 单元测试 | `npm test` | 通过：6 项，pass 6 / fail 0 / duration 102.9ms |
| 结构检查 | `npm run check` | 通过：`PASS 40 syntax/config/page checks.` |
| 规范校验 | `npm run openspec -- validate --all --strict` | 通过：1 passed, 0 failed |

上一节列为「未执行」的三条现已全部执行并通过。**规范校验同时确认：`specs/inspiration-heat/spec.md` 虽已从提案的能力清单中移除，仍留在变更目录内，但未导致 `--strict` 校验失败。** 归档前移出该目录的要求依然有效。

### 关于结构检查计数由 39 变为 40

不是代码改动造成的，仓库内容未变。`scripts/check.cjs` 遍历仓库内所有 `.json`（仅跳过 `node_modules`、`.git`、`qa`、`.agents`），本次会话中客户端在 `.claude/` 下生成了 `settings.local.json`，被计入 +1。该文件未被 git 跟踪，且被全局 ignore 规则 `**/.claude/settings.local.json` 排除，不会进入仓库。

**但这暴露一个可复现性问题**：`PASS N` 中的 N 取决于本机是否存在该文件，同一份代码在不同机器上会得到不同的数字，不适合作为跨环境比对的基线。后续若要稳定该数字，需让 `check.cjs` 跳过 `.claude/`，或改为只记录「通过 / 失败」而不记录计数。**本次不做改动**，仅记录该问题。

### 未验证项（仍然）

- 微信开发者工具中的 WXML/WXSS 真实编译与渲染。
- 云函数部署、集合创建、云存储权限配置。
- AI 真实调用、额度与内容安全验证。
- 双账户隔离、断网上传、权限拒绝等真机验收。

以上各项均不得在未执行的情况下勾选 `tasks.md` 中对应条目。
