# 验证记录

本文件记录每次验证的实际命令与结果。**未执行的项不得写成通过。**

## 2026-09-28 · 组件按需注入代码质量项

- 微信开发者工具截图显示「代码质量 → 组件 → 启用组件按需注入」未通过。当前项目 `project.config.json` 指向 `miniprogram/`，对应 `miniprogram/app.json` 原先没有 `lazyCodeLoading`。
- 在 `miniprogram/app.json` 增加 `"lazyCodeLoading": "requiredComponents"`，并新增配置回归测试；未改动页面清单、`project.config.json` 或云端资源。待在微信开发者工具点击「重新扫描」核对该项，不能把本地配置检查当作平台扫描通过。
- 本地验证：`npm test` 360/360，`npm run check` 218，OpenSpec strict 7/7，`git diff --check` 通过。账户唯一索引的云端待确认任务不受此次配置修改影响，仍须按任务 ID 核验。

## 2026-09-28 · 六集合齐备，首个业务索引待确认

- 恢复 `linggan_ai_usage` 创建任务 `confirmation_cloud_db_write_struct_b84508cf-f347-4b06-b2e0-55e44d8db0e2`，返回 `success / execution_success`，创建 requestId=`bb52533f-7c98-4810-81aa-eff100e71e91`。资源方集合列表 requestId=`66de1741-c13e-485c-8256-537b9051bab8` 回读六个 `linggan_` 集合均存在且 Count=0、IndexCount=2；未重发创建。
- `linggan_accounts` 的索引列表 requestId=`e71dcc45-628f-4d46-8b1d-b7e92bec0b15` 仅有 `_id_`、`_openid_1`。使用 `deployment/product/indexes/linggan_accounts.json` 发起 `accountKey_unique` 唯一索引创建，返回 `pending / Waiting for user confirmation.`，taskId=`confirmation_cloud_db_write_struct_ad4ce1aa-5e82-4f8a-a117-005a71516a0d`。尚未计作成功；无其他并发云写，未使用 CloudBase CLI。
- 本地复验 `npm test` 359/359、`npm run check` 217、OpenSpec strict 7/7、`git diff --check` 通过；云端索引仍待平台确认，工作区改动尚未提交。

## 2026-09-28 · 最后一个集合创建待平台确认

- 用户要求继续创建。`check_wechatide_status` 返回版本匹配、登录未过期、无 CLI token 要求。资源方集合列表 requestId=`3f65539a-ac0b-4809-b37d-168435f15099` 确认仍只有五个 `linggan_` 集合，均 Count=0、IndexCount=2；`linggan_ai_usage` 缺失。
- 对 `product-d2g59zty74d7d1ec1` 发起 `cloud_db_write_struct --action createCollection --collection-name linggan_ai_usage`，返回 `pending / Waiting for user confirmation.`，taskId=`confirmation_cloud_db_write_struct_b84508cf-f347-4b06-b2e0-55e44d8db0e2`。这**不是创建成功**；按微信开发者工具异步规则不主动轮询、不重发、不并行发起其他云写。未使用 CloudBase CLI。
- 本地复验：`npm test` 359/359、`npm run check` 217、OpenSpec strict 7/7、`git diff --check` 通过。云端剩余资源及小程序上传尚未验证或完成，改动尚未提交。

## 2026-09-28 · 停用未成功的 CLI 路线并回读资源

- 用户明确要求不用 CloudBase CLI。上次 `tcb login --flow web` 未成功；尝试停止会话时进程已结束，期间没有通过 CLI 进行云写。已从当前部署输入移除 `cloudbaserc.json` 和对应本地测试，忽略目录中原先下载的 CLI 包不再调用；历史尝试保留在下文。
- `wechatide` 资源方集合列表 requestId=`a6299c52-a5e5-4257-9281-f50884a0564d` 再次回读：本项目五个已建集合均 Count=0、IndexCount=2，`linggan_ai_usage` 仍缺失。仅查询集合元数据，未读取其他项目文档或写云资源。
- 已注册的微信开发者工具工具声明 `cloud_db_write_struct` 每次仅接收一个 `collectionName`，`cloud_fn_deploy` 每次仅接收一个函数目录；写操作须逐笔平台确认。未发现符合用户“不逐笔确认”要求的受支持批量入口；没有待确认云写任务，本轮不再发起写入。
- `cloud_fn_list` 回读资源方环境现有九个函数，无 `linggan_api`、`linggan_ai`、`linggan_maintenance`。未查询或修改其他函数内容。
- 移除未采用路线的本地配置后复验：`npm test` 359/359、`npm run check` 217、OpenSpec strict 7/7、`git diff --check` 通过。无新云写、无小程序上传；工作区改动尚未提交。

## 2026-09-28 · product 第五个集合与一次登录准备

- 原待确认任务 `confirmation_cloud_db_write_struct_f2896fc3-efee-4a84-9ba7-3778a9416b85` 查询为 `success / execution_success`，创建 requestId=`79e46139-cdd4-4c03-9e25-65d7d70b75b3`。资源方完整集合列表 requestId=`9e6b8964-dc45-4f4f-85e2-e62c89a033ff` 回读五个本项目集合都存在且 Count=0。未重复创建、未读取其他项目文档。
- 用户要求不要逐笔确认。已注册的 wechatide `cloud_db_write_struct` 只能针对一个集合；当前没有云写待确认任务，不再发起新的逐笔确认。官方 CloudBase CLI 3.8.4 安装在已忽略的 `qa/local/cloudbase-cli/`；`tcb login --flow web` 已启动但等待用户在官方页面完成一次授权。CLI 登录及随后目标环境权限尚未验证，未进行任何 CLI 云写。未读取开发者工具本机凭据。
- 新增 `deployment/product/cloudbaserc.json`：仅列出三个 `linggan_` 函数，环境指向 product，无环境变量、密钥或触发器。`tcb validate --json` 返回 valid=true、functions=3、errors=[]、warnings=[]。官方 API 文档确认 `tcb api` 使用登录凭据、CreateTable / UpdateTable / ModifySafeRule 针对明确集合；尚未实际调用。共享环境的全局 `tcb policy set` 明确禁止。
- 本地复验 `npm test` **360/360**、`npm run check` **218**、OpenSpec strict **7/7**，`git diff --check` 通过。未部署函数、索引、权限或客户端，未执行 AI、照片和保留清理；本地改动尚未提交、推送或合并。

## 2026-09-28 · product 第四个集合已创建

- 恢复配额集合任务 `confirmation_cloud_db_write_struct_7d75bcd9-869d-44db-bee1-13615d421447`，终态 `success / execution_success`，创建 requestId=`b1b968d0-7b39-4ee3-b2b4-7dbc74c3e0eb`；未重发。
- 资源方完整集合列表 requestId=`667198df-183a-4f1e-ae80-2616e4a2f52c` 确认 accounts、shares、feedback、usage 四个 `linggan_` 集合存在且 Count=0。未读取或改写其他项目业务数据。
- 发起 `linggan_rate_limits` 创建，返回 `pending / Waiting for user confirmation.`，taskId=`confirmation_cloud_db_write_struct_f2896fc3-efee-4a84-9ba7-3778a9416b85`。按 wechatide 技能暂停云写，未计为创建成功。`linggan_ai_usage`、所有业务索引、规则及三个函数未实施。
- 抓取 origin/dev 成功，保留既有工作区修改。没有函数部署、客户端上传、AI 调用或清理。

## 2026-09-28 · product 第三个集合已创建

- `wechatide` 0.3.9 检查为 `versionRelation=equal`、`loginExpired=false`、`tokenRequired=false`。旧待确认任务 `confirmation_cloud_db_write_struct_04b659a0-5292-470a-9d3f-965611a0fa70` 返回 `success / execution_success`，创建 requestId=`f4d634ab-cbeb-4eb0-a3c6-9df85cd9e24a`；未重发。
- 用资源方查询完整集合列表，requestId=`c60e4886-17b8-406d-bbe6-b3934d019e0b`，回读 `linggan_accounts`、`linggan_shares`、`linggan_feedback` 均存在且 Count=0。未读取其他项目文档，不对其资源变化做写入。
- 发起 `linggan_usage` 创建，返回 `pending / Waiting for user confirmation.`，taskId=`confirmation_cloud_db_write_struct_7d75bcd9-869d-44db-bee1-13615d421447`。按 wechatide 技能暂停云写；不得计作已创建，也不主动轮询或重发。
- `git fetch origin dev` 成功，保留 dev 上现有未提交修改；没有业务代码改动、函数部署、客户端上传、AI 调用或数据清理。

## 2026-09-27 · product 第二个集合已创建

- 恢复分享集合任务 `confirmation_cloud_db_write_struct_9906885f-69f2-450a-aa7c-a805162abf78`，终态 `success / execution_success`，创建 requestId=`f1992c87-5492-46c5-a061-e921dee57db2`。未重复创建。
- 资源方完整集合结构回读 requestId=`7d1568d1-e6af-48be-acc8-76e8deb374d0`，确认 `linggan_accounts`、`linggan_shares` 均存在且 Count=0。共享环境中其他项目亦有资源变化，本轮未修改那些资源，不据此改动本项目清单。
- 两集合索引列表分别回读 requestId=`9d41fa9c-053e-41c9-833a-869b89e74c47`、`6ea92c4c-4e5c-4c09-8e0c-954a1e88ca1c`，都只有平台自带 `_id_`、`_openid_1`，业务索引尚未创建；未读取业务文档。
- 新发起 `linggan_feedback` 创建，任务 `confirmation_cloud_db_write_struct_04b659a0-5292-470a-9d3f-965611a0fa70` 返回 `pending / Waiting for user confirmation.`。按 wechatide 技能暂停写入，不主动轮询、不重复发起。其余三集合、索引、规则和函数部署未发起；未进行真实业务调用或客户端上传。
- 更新部署与待办记录，未改业务代码。抓取 origin/dev 后保留工作区；本轮复跑 359 项测试、217 项结构检查（含副本一致性）、7 项 OpenSpec strict 全部通过。未启用 AI/照片/维护清理，未提交、推送或合并。

## 2026-09-27 · product 首个集合已创建与完整资源输入

用户要求自行创建全部所需集合及函数。本轮继续在 dev，`git fetch origin dev` 成功，远端无新增、本地仍领先原有 1 个提交，保留既有工作区改动。

- 先查询此前账户集合任务 `confirmation_cloud_db_write_struct_5e0105b9-6089-41b6-9faa-a52ede9a632c`，返回 `status=success / detail=execution_success`；内部创建成功 requestId 为 `2c972983-3743-4c33-ba7c-58ffca52bf73`。没有重复提交创建请求。
- 以资源方 `wx7ad85943fe81e095` 对 `product-d2g59zty74d7d1ec1` 回读完整集合结构，requestId=`cc8f91ac-5614-4531-8cad-8af94e95a3dc`；`linggan_accounts` 存在，Count=0。未读取任何业务文档；列表不构成权限或业务唯一索引验证。
- 发起 `linggan_shares` 创建，返回 `status=pending / Waiting for user confirmation.`，任务为 `confirmation_cloud_db_write_struct_9906885f-69f2-450a-aa7c-a805162abf78`。依微信开发者工具技能暂停当前云端写入，不自行确认、不轮询、不重发。其余四集合、全部业务索引与权限、三个函数均未实施。
- 新增 `deployment/product/manifest.json`、5 份 CreateIndexes 输入和执行说明：6 个集合、15 个业务索引（含 5 个唯一）、3 个函数。没有 DropIndexes、TTL、测试业务数据或真实密钥。AI、照片、维护目标配置保持关闭，维护无触发器。索引参数形状依据腾讯云 UpdateTable 官方文档核对，尚未向平台提交索引请求。
- 新增 3 项部署清单测试，覆盖目标身份、资源范围、每个索引的字段/方向/唯一性、禁用删除/TTL 输入及函数安全配置。`npm test` **359/359**；`npm run check` **217**（含共享副本一致性）；OpenSpec strict **7/7**；`git diff --check` 通过。本轮没有修改业务代码或生成副本，无需重新生成云函数代码。
- 工具帮助核对：当前云结构写入仅支持集合和索引，函数部署仅支持目录与远端安装依赖；未提供安全规则、环境变量、超时配置入口。后续仍需支持这些能力的正常平台入口，不读取本机凭据或使用隐藏接口。

本轮未部署函数、未上传或公开发布客户端，未进行真实共享调用、WXML/WXSS 渲染、两账户、AI、私有文件或真机验收。未修改其他项目资源、共用认证或全局存储规则，未执行清理。所有本地新增文件和修改尚未提交、未推送。

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

## 2026-09-22 · 实现领域层 core/ 三个模块（任务 1.1—1.3）

范围：仅实现 `miniprogram/core/` 下的领域逻辑与对应单元测试。**未实现任何页面逻辑、未接入服务层、未改动云与 AI 开关（仍为 `false`）、未做任何云端操作。**

新增与修改：

| 文件 | 说明 |
| --- | --- |
| `miniprogram/core/errors.js`（新增） | `ERROR_CODES`、面向用户的中文 `ERROR_MESSAGES`、`ValidationError` |
| `miniprogram/core/inspiration.js`（新增） | 灵感、补充、图片记录的创建与校验；纯函数、深冻结、不导出改写 `text` 的路径 |
| `miniprogram/core/ai-contract.js`（新增） | AI 输出的结构 / 类型 / 长度校验，以及内容安全过滤 |
| `miniprogram/core/limits.js`（扩展） | 新增 `idMaxLength`、`aiMinTextLength`、草案条目数与长度上限；已有取值未改动 |
| `tests/inspiration.test.cjs`（新增） | 22 项 |
| `tests/ai-contract.test.cjs`（新增） | 17 项 |

### 验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 通过：45 项（原有 6 + 新增 39），pass 45 / fail 0 |
| 结构检查 | `npm run check` | 通过：`PASS 45 syntax/config/page checks.` |
| 规范校验 | `npm run openspec -- validate --all --strict` | 通过：1 passed, 0 failed |

结构检查计数由 40 增至 45，对应新增的 5 个 `.js` / `.cjs` 文件，符合预期。

### 实施中发现并修正的问题

**图片重试覆盖时改写了 `createdAt`。** `appendPhoto` 对同一 `photoId` 的重复追加按覆盖处理，初版实现用重试时刻覆盖了原 `createdAt`。这不影响「不产生重复记录」，但会让一条早已上传的图片在重试后变成刚创建。由用例「同一图片重复追加按覆盖处理，不产生重复记录」抓出，已改为覆盖时保留原 `createdAt`。**这正是先写测试的价值——该问题在只有手工验证时几乎不可能被发现。**

### 与任务描述的偏差（需你确认）

任务 1.3 要求四类非法输入「均须抛错」。实际实现的主入口 `validateDraft` **返回结果对象而非抛错**，理由是调用方需要把契约校验失败当作一次可重试的生成失败来处理，用异常控制流程会迫使页面处处 try/catch。抛错版 `parseDraft` 已一并提供且有用例覆盖，四类输入均被拒绝这一实质要求已满足。**若你要求主入口也抛错，改动很小，告诉我即可。**

### 未验证项（仍然）

- 微信开发者工具中的 WXML/WXSS 真实编译与渲染。
- 服务层、页面层、云函数、云存储——均尚未实现。
- AI 真实调用、额度与内容安全（规则集已有基线，条目本身待评审）。
- 双账户隔离、断网上传、权限拒绝等真机验收。

以上各项均不得在未执行的情况下勾选 `tasks.md` 中对应条目。

## 2026-09-22 · 按最新需求把领域层拉回与规范一致

背景：用户提出四项新需求（原文可编辑、多次补充、AI 汇总多条补充、勾选多个灵感汇总），其中第一项**推翻了原设计的核心约束「原始记录不可改写」**。规范已按提案流程更新，本次把 `core/` 拉到与新规范一致。

范围：只改 `miniprogram/core/` 与对应测试，**未实现页面、服务层、云函数、云存储**，云与 AI 开关仍为 `false`。

### 需求变更对代码的影响

| 变化 | 说明 |
| --- | --- |
| **撤销**「不导出任何改写 `text` 的函数」 | 新增 `updateText` 作为唯一的改写路径 |
| **新增约束**「改写必须留历史」 | `updateText` 签名强制要求 `historyId`，不提供调用方式可绕过 |
| **新增**汇总与已合并 | `mergeSupplements`、`markSupplementMerged` / `unmergeSupplement`、`markMerged` / `unmerge` |
| **新增**汇总结果契约 | `validateSummary` / `parseSummary` / `isTooFewToSummarize` |

### 改写过的旧用例（未保留）

| 旧用例 | 处理 |
| --- | --- |
| 「不导出任何可改写原始正文的路径」 | **删除**。新规范下改写是合法路径，留着会让旧约束以测试形式继续生效 |
| 「追加补充后原始正文与初始值全等」 | **改写**为「追加补充后正文不变，原对象不被修改」——追加不改正文仍然成立，但它不再是「原文不可变」的证据 |
| 「创建结果被冻结，运行时改不动」 | **改写**为「深冻结保留——防的是误改内存对象，不是阻止合法改写」，并补一条断言：深冻结之下合法改写照样能走通 |

### 验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 通过：74 项（原 45 + 新增 29），pass 74 / fail 0 |
| 结构检查 | `npm run check` | 通过：`PASS 46 syntax/config/page checks.` |
| 规范校验 | `npm run openspec -- validate --all --strict` | 通过：1 passed, 0 failed |

### 实施中的两个设计取舍

**`mergeSupplements` 做成单次调用的原子操作**，而不是让调用方自己拼「`appendSupplement` + `markSupplementMerged`」。规范要求「失败不留痕」，分两步的话中间任何一步出错都可能留下空汇总结果或半合并状态。现在全部在内存里算完再一次性返回，调用方拿到的要么是完整结果，要么什么都没发生。已由用例「汇总失败不留痕」覆盖。

**`updateText` 把 `historyId` 设为必填**。这是刻意的——让「改写但不留历史」在调用层面根本写不出来，而不是靠实现者记得。签名本身就是约束，比文档更可靠。

### 新增的待评审项

`core/limits.js` 里新增的四个汇总相关取值（`mergeMinItems`、`summaryMaxLength`、`summaryMaxSourceItems`、`summaryMaxSourceChars`）**没有明确依据**，是实施时取的保守默认。已在代码注释中标注「需要评审后定稿」，对应 `detailed-design.md` §11 第 10 项。

### 未验证项（仍然）

- 微信开发者工具中的 WXML/WXSS 真实编译与渲染。
- 服务层、页面层、云函数、云存储。
- AI 真实调用、额度与内容安全（规则集条目本身待评审）。
- 汇总的**页面流程**（选中、预览、覆盖/另存的选择与确认）——领域层已就绪，交互层未实现。
- 双账户隔离、断网上传、权限拒绝等真机验收。

以上各项均不得在未执行的情况下勾选 `tasks.md` 中对应条目。

## 2026-09-22 · 单条补充的直接操作（任务 1.4）

需求：长按一条补充弹出「修改 / 汇入原文 / 删除」，点击不同按钮走不同处理。

范围：只加规范与 `core/` 领域逻辑及测试，**未实现页面交互**（长按面板与删除确认属页面层，见 tasks.md 3.6）。云与 AI 开关仍为 `false`。

### 规范新增

`inspiration-capture` 新增 Requirement「单条补充的直接操作」。三者对数据的影响本就不同，规范里直接列成表：

| 操作 | 对内容 | 可否恢复 |
| --- | --- | --- |
| 修改 | 替换内容，旧内容进该条自己的 `contentHistory` | 历史可回看 |
| 汇入原文 | 内容追加进原文，本条写 `foldedAt` | 可展开、可恢复 |
| 删除 | 移除本条 | **不可恢复** |

**「删除」是真删，与 §4.2 的 AI 汇总「覆盖」不真删并不矛盾。** 覆盖是 AI 的输出顶掉用户写的内容，用户没有主动选择丢弃；删除是用户自己点下的动作，弹窗就是确认。**说删除却只是收起，是欺骗。**

### 实施中发现的两处容易踩空的地方

**删掉汇总结果会留下悬空引用。** 若 sup_a、sup_b 被汇总进 sup_sum，直接删掉 sup_sum，那两条的 `mergedInto` 就指向了一个不存在的目标——它们会永远收在时间线里出不来，用户既看不到也不知道为什么。`removeSupplement` 因此必须顺带把指向它的补充恢复。已由用例「删除汇总结果时，指向它的补充一并恢复——不留悬空引用」覆盖，该用例逐条断言不残留指向不存在目标的引用。

**汇入可能撑破正文上限。** 补充上限 1000、正文上限 2000，一条接近上限的补充汇进一条已经接近上限的正文就会越界。长度校验放在 `foldIntoText` 里，超了整条拒绝、不截断，也不留下半汇入状态。已由用例「汇入撑破正文上限时整条拒绝，不做截断」覆盖。

### 其余约束

- 修改补充与改写原文同一套规则：**必须**同时提供 `historyId`，不提供就写不了。
- 已合并／已汇入的补充不允许直接修改，返回 `ALREADY_MERGED` / `ALREADY_FOLDED`——它们已经不在时间线上正常显示，先恢复再改。
- 恢复已汇入的补充**不回退原文**。`unfoldSupplement` 只清 `foldedAt`；回退原文是另一回事（从 `textHistory` 取回），塞进这里会让用户以为「恢复」等于撤销。

### 验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 通过：89 项（上一轮 74 + 新增 15），pass 89 / fail 0 |
| 结构检查 | `npm run check` | 通过：`PASS 46 syntax/config/page checks.` |
| 规范校验 | `npm run openspec -- validate --all --strict` | 通过：1 passed, 0 failed |

实施过程中有一条用例断言写错（把未被选中的 sup_3 也当成了已合并），由测试直接失败暴露，改的是断言而非实现。

### 同时记录了一条未立项的想法

用户提出「操作可撤回，撤回作为会员功能，待后续开发」。已记入 `docs/BACKLOG.md`，并在 `proposal.md` 非目标处加了指针。

**该想法与当前非目标「不接入支付与会员」直接冲突**，推进前必须先决定怎么处理这条非目标——那是产品边界的决定，不是实现细节。记录时一并写明了它落地后会连带影响的地方：规范里「删除后无法恢复」这句对会员将不再成立，届时需改成条件表述，但**删除确认弹窗不能取消**——撤回是补救，不是允许粗心的理由。

### 未验证项（仍然）

- 微信开发者工具中的 WXML/WXSS 真实编译与渲染。
- **长按操作面板与删除确认的页面交互**——领域层已就绪，交互层未实现。
- 服务层、云函数、云存储、AI 真实调用。
- 双账户隔离、断网上传、权限拒绝等真机验收。

以上各项均不得在未执行的情况下勾选 `tasks.md` 中对应条目。

## 2026-09-22 · 原型文案修订（不改变行为）

用户对原型提出的四条文案意见，均已落在 `docs/ui-mockup.html` 与 `docs/ui-design.md`。本次**未改动任何 JS 代码与规范**。

| 意见 | 处理 |
| --- | --- |
| 「覆盖原来的」改为「覆盖灵感」 | 灵感汇总用「覆盖灵感」/「一个新灵感」；**补充汇总用「覆盖补充」/「新增补充」**——「覆盖灵感」用在补充上是错的动作描述。两组标签都记入 `ui-design.md` 6.3 |
| 「存一个新的」改为「一个新灵感」 | 同上 |
| 按钮等不要太口语化 | 「去记一条」→「新建灵感」、「再补充一点…」→「添加补充」、「删除这条灵感」→「删除灵感」、「删除后无法恢复」→「此操作无法撤销」。新增 `ui-design.md` 6.2 记录这条规则与判断标准 |
| 删除弹窗里的引用与提示没有关联 | 弹窗重构：标题改为「删除补充」，正文「这条补充将被移除，此操作无法撤销」，**待删内容移入一个带记录时间的框**，让「要删的就是这条」连起来，不再是一句孤零零的引用加一句提示 |

另外修了原型自身的一处不一致：删除确认那屏的背景时间线原写「3 条补充」却只画了 1 条，已补全为 3 条，使弹窗指向的那条在背景里可见。

**追加（同日稍后）：「汇入原文」改名为「合并进灵感」。** 用户可见的标签全部改过——规范、原型、UI 设计、详细设计、任务、BACKLOG。代码里的 `foldIntoText` / `foldedAt` **保持不变**：那个名字描述的是机制（把内容折进正文），比跟着文案改更准确；对应关系已写进 `detailed-design.md` §4.3。

改名同时暴露一个术语冲突，已在规范里立了对照表：**「合并」在本产品里有两个用法**——长按面板的「合并进灵感」并入的是**灵感原文**（`foldedAt`），AI 汇总的「覆盖补充 / 覆盖灵感」并入的是**汇总结果**（`mergedInto`）。界面文案必须让目标可分辨，**不能只写「合并」两个字**。

**「没有关联」这条意见我做了理解**：判断为用户指的是弹窗里那句引用孤立地浮着、没说清它是谁。若原意是别的，属于重新表述的范畴，改起来只动 `ui-design.md` 第 4 节 B 与原型对应两屏。

### 验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 通过：89 项，pass 89 / fail 0 |
| 结构检查 | `npm run check` | 通过：`PASS 46 syntax/config/page checks.` |
| 规范校验 | `npm run openspec -- validate --all --strict` | 通过：1 passed, 0 failed |

### 未验证项（仍然）

- 微信开发者工具中的 WXML/WXSS 真实编译与渲染。
- 服务层、页面层、云函数、云存储、AI 真实调用。
- 双账户隔离、断网上传、权限拒绝等真机验收。

以上各项均不得在未执行的情况下勾选 `tasks.md` 中对应条目。

## 2026-09-22 · 补数据库设计，加两道防跑偏闸门

用户要求完善概设、详设、原型图、数据库设计以防后续跑偏，并追问「spec 生效了吗」。

### 先量了一下 spec 到底生效没有

写了个脚本核对：规范里 **83 条场景**（不含已暂缓的热度），只有 **4 条**能按测试名对上一—因为测试名带后缀，前缀匹配命中率极低。

但这个数字本身说明的是更根本的问题：**仓库里没有任何东西能告诉你哪条规范有实现、哪条没有。** 规范约束了我写什么，但它没有强制力——加了新场景没人管，删了旧实现也没人知道。

### 两道闸门（都在 `npm test` 里跑）

| 闸门 | 守住什么 | 负向验证 |
| --- | --- | --- |
| `tests/spec-coverage.test.cjs` | 规范与 `docs/spec-coverage.md` 完全对齐；标为「已覆盖/部分覆盖」的条目必须指向真实存在的测试 | **已实测**：往规范里加一条假场景，测试立即变红并点名该场景；还原后恢复绿 |
| `tests/copy-rules.test.cjs` | 产品代码里不出现禁用措辞（开发痕迹、本机/云端分层、旧标签、推销句式、热度暗示） | **已实测**：第一次运行就抓到 4 处真问题 |

**第二道闸门第一次跑就抓到了真问题**，这正是它存在的意义：

| 位置 | 问题 |
| --- | --- |
| `miniprogram/pages/list/index.wxml` | 按钮仍写「去记一条」。原型与设计文档早已改成「新建灵感」，**真实页面漏改了** |
| `cloudfunctions/linggan_api/index.js` | 返回给前端的 `message` 写「当前仅为工程骨架」，属开发阶段自述 |
| `cloudfunctions/linggan_api/package.json` | description 写「（骨架，未部署）」 |

三处均已修正。

### 新增文档

| 文档 | 内容 |
| --- | --- |
| `docs/spec-coverage.md` | 83 条场景逐条列出状态与对应测试。**这张表本身就是「哪些做了、哪些没做」的清单** |
| `docs/database-design.md` | 集合与字段定义、索引、权限规则、容量估算、事务边界，以及**「数据库不替我们守的约束」清单** |
| `detailed-design.md` §0 文档地图 | 每份文档只回答自己的问题，附两道闸门的说明 |

`docs/spec-coverage.md` 顺带暴露出一条真实缺口：**「勾选多个灵感汇总」没有实现**——领域层只提供了 `markMerged` / `unmerge` 两个原语，没有灵感级的汇总编排函数。已记入 task 5A.3。

覆盖率现状：已覆盖 38、部分覆盖 8、待实现 37。待实现的全部属于界面层、服务层、云端或照片能力，属预期。

### 验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 通过：95 项（原 89 + 闸门 6），pass 95 / fail 0 |
| 结构检查 | `npm run check` | 通过：`PASS 48 syntax/config/page checks.` |
| 规范校验 | `npm run openspec -- validate --all --strict` | 通过：1 passed, 0 failed |

### 未验证项（仍然）

- 微信开发者工具中的 WXML/WXSS 真实编译与渲染。
- 服务层、页面层、云函数、云存储、AI 真实调用。
- 双账户隔离、断网上传、权限拒绝等真机验收。
- 覆盖率表里 37 条「待实现」与 8 条「部分覆盖」——**这张表记录的是现状，不是完成度证明**。

以上各项均不得在未执行的情况下勾选 `tasks.md` 中对应条目。

## 2026-09-22 · 第三道闸门：设计契约

用户追问「已确定的这些设计，后续开发时会一一核对吧，不会无视吧」。

这是个该问的问题。当时的状态是：**两道闸门守住了「规范」和「措辞」，但详设里的模块签名、取值边界，以及数据库设计的字段清单，与代码之间没有任何联动。** 改了函数签名忘了改文档，不会有人发现。

### 先量了一下，已经跑偏了

写脚本比对 `core/limits.js` 与详设 §7.3 的表：**代码里 15 个键，文档只记了 5 个**。其中 4 个（`mergeMinItems`、`summaryMaxLength`、`summaryMaxSourceItems`、`summaryMaxSourceChars`）还是同一轮里刚加的——**加了代码忘了改文档，就发生在几小时之内。**

### 新增 `tests/design-contract.test.cjs`

| 核对项 | 比对方式 |
| --- | --- |
| `core/inspiration.js` 的导出 ↔ 详设 §7.1 函数清单 | `module.exports` 里的每个函数，少一个多一个都红 |
| `core/limits.js` 的键 ↔ 详设 §7.3 取值表 | 同上 |
| `createInspiration` 产出的字段 ↔ 数据库设计 §3.2 | **调用真实构造函数**，比对它实际产出的字段 |
| `textHistory` 条目字段 ↔ §3.3 | 同上 |
| `supplements` 条目字段 ↔ §3.4 | 同上 |
| `photos` 条目字段 ↔ §3.5 | 同上 |

字段类核对刻意**不解析源码**，而是跑一遍拿到真实对象再比对——重命名、增删字段都会暴露，不会因为改的是实现细节而漏过。

### 闸门第一次跑就抓到一处真跑偏

**7 个导出的函数根本没写进详设 §7.1**：`isDeleted`、`isMerged`、`isSupplementHidden`、`activeSupplements`、`mergedSupplements`、`foldedSupplements`、`byUpdatedAtDesc`。已补进文档。

### 负向验证（两个都做了）

| 动作 | 结果 |
| --- | --- |
| 临时往 `core/limits.js` 加一个未记录的键 | 测试立即变红并点名 `contractProbe`；还原后恢复绿 |
| （前一轮）往规范里加一条假场景 | 覆盖率闸门立即变红并点名；还原后恢复绿 |

### 同时写进 `AGENTS.md`

新增「设计与文档」一节：动手前先看文档地图；三道闸门必跑；实现后必须改覆盖率表的状态；改签名 / 取值 / 字段前先改文档。并明确写下**闸门管不到的三件事**（实现对不对、界面与原型是否一致、状态标得对不对），避免把闸门当成质量保证。

### 验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 通过：102 项（原 95 + 契约 7），pass 102 / fail 0 |
| 结构检查 | `npm run check` | 通过：`PASS 48 syntax/config/page checks.` |
| 规范校验 | `npm run openspec -- validate --all --strict` | 通过：1 passed, 0 failed |

### 未验证项（仍然）

- 微信开发者工具中的 WXML/WXSS 真实编译与渲染。
- 服务层、页面层、云函数、云存储、AI 真实调用。
- 双账户隔离、断网上传、权限拒绝等真机验收。
- **界面与原型的一致性没有任何自动检查**——原型是 HTML、真实页面是 WXML，两者之间只能靠人在开发者工具里比对。
- 覆盖率表里的状态标注是人工判断，标错了闸门不会拦。

以上各项均不得在未执行的情况下勾选 `tasks.md` 中对应条目。

## 2026-09-22 · 开始开发：服务层（任务 2.1—2.3）

用户授权开始开发。本轮只做**不需要任何云端授权**的第 2 节，未触碰云函数、集合、AI 与页面。

### 新增模块

| 模块 | 职责 |
| --- | --- |
| `miniprogram/services/store.js` | 本机快照、待同步队列、保存的三条路径 |
| `miniprogram/services/capture-drafts.js` | 未提交补充的会话内草稿 |
| `miniprogram/services/wx-storage.js` | wx 同步存储的适配器 |

### 一个决定了整层可测性的设计

**存储与网络都从外面注入，不直接依赖 wx。** 这样离线、配额耗尽、同步失败这三条路径能在 Node 里直接断言——它们在真机上很难稳定复现，却占了规范里一半的场景。

`saveInspiration` 因此返回三种形态，与界面上的三种呈现一一对应：

| 返回 | 界面 |
| --- | --- |
| `{ ok: true, synced: true }` | 已保存 |
| `{ ok: true, synced: false, code }` | 已保存。还没同步到云端，会自动重试 |
| `{ ok: false, code: 'LOCAL_WRITE_FAILED' }` | 存储空间不够了，这条没能存下来 + 保留输入 |

执行顺序也是刻意的：**先落本机 → 再入队 → 最后发起同步**。入队必须早于同步，否则同步途中崩溃，这条意图就丢了——用户以为已经保存，而云端和队列里都没有它。本机写入失败时**不去调用云端**，下游没有东西可同步，调用只会浪费一次请求。

### 顺带发现并补上的一处规范缺口

任务 2.2 的「未提交补充的会话内草稿」在规范里**没有任何对应场景**——是**任务有、规范没有**。已补写为 `inspiration-capture` 的「未提交的补充不因切页丢失」（4 条场景）。

这与 `spec-coverage.md` 里那条「勾选多个灵感汇总没实现」方向相反，但同样是跑偏。

### 覆盖率闸门当场抓到我自己

补完规范场景后忘了同步 `docs/spec-coverage.md`，`npm test` 立即变红并点名 4 条新场景。已补。**这是闸门第一次在真实开发流程中拦下问题**，而不是在负向验证里。

另有一处自己写的语法错误（`for...of` 写成 `for (...) =`），由测试运行器直接报出，已修。

### 验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 通过：129 项（原 102 + 服务层 27），pass 129 / fail 0 |
| 结构检查 | `npm run check` | 通过：`PASS 54 syntax/config/page checks.` |
| 规范校验 | `npm run openspec -- validate --all --strict` | 通过：1 passed, 0 failed |

覆盖率：87 条场景中已覆盖 45、部分覆盖 9、待实现 33（本轮新增覆盖 7 条）。

### 未验证项（仍然）

- **服务层没有在真机上跑过。** `wx-storage.js` 是 wx API 的薄封装，Node 测试里注入的是内存替身——**适配器本身只有 `npm run check` 的语法检查兜底**。
- 微信开发者工具中的 WXML/WXSS 真实编译与渲染。
- 页面层、云函数、云存储、AI 真实调用。
- 双账户隔离、断网上传、权限拒绝等真机验收。
- `saveInspiration` 的「提示文案与输入保留」属界面层，尚未实现（task 3.1、3.2）。

以上各项均不得在未执行的情况下勾选 `tasks.md` 中对应条目。

## 2026-09-22 · 页面层（任务 3.1—3.5）

四个页面 + 一个新增的历史版本页，接上第 2 节的服务层。仍然**没有触碰云端**。

### 做了什么

| 页面 | 实现范围 |
| --- | --- |
| `pages/capture` | 记录 + 保存，三种返回形态对应三种界面状态 |
| `pages/list` | 倒序列表、空态、读取失败态（**失败时保留已渲染内容**） |
| `pages/detail` | 原文**可编辑**、历史入口、补充时间线、追加补充、删除 |
| `pages/history` | **新增页**：历史版本倒序 + 当前原文对照 |
| `pages/mine` | 能力状态、数据与隐私、反馈 |

另外重写了 `app.wxss`——设计令牌此前只存在于文档和原型里，代码里还是骨架的旧值。

### 一处新增的能力状态

页面写完但**只有人能验**——WXML/WXSS 渲染与真机交互在 Node 里测不了，而原型是 HTML、真实页面是 WXML，两者之间没有任何自动比对。所以覆盖率表新增了「**待验收**」状态，与「已覆盖」严格分开：

> 「待验收」不是「已覆盖」的委婉说法。在开发者工具里走通、并在 `VERIFICATION.md` 留下证据之前，它就只能停在「待验收」。

闸门同步加了一条：标「待验收」的条目必须写清**在哪验**，否则会悄悄变成「已覆盖」的同义词。

### 两个被闸门挡下的地方

- 加了 4 条规范场景（未提交补充的草稿）后忘了同步覆盖率表 → 闸门当场变红并点名。已补。
- 自己写的 `for...of` 笔误（写成 `for (...) =`）→ 测试运行器直接报语法错误。已修。

### 验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 通过：150 项（原 129 + 格式化 16 + 删除 3 + 闸门 2），pass 150 / fail 0 |
| 结构检查 | `npm run check` | 通过：`PASS 61 syntax/config/page checks.` |
| 规范校验 | `npm run openspec -- validate --all --strict` | 通过：1 passed, 0 failed |

覆盖率：87 条场景中已覆盖 46、部分覆盖 7、**待验收 3**、待实现 31。

### 未验证项（这一轮的重点）

**四个页面一个都没有在开发者工具里打开过。** 具体没验的：

- WXML/WXSS 能否正常编译——`npm run check` 只做语法与文件结构检查，**不编译 WXML**。
- 五个页面之间的跳转（记录 → 列表 → 详情 → 历史）能否走通。
- 长按、输入、按钮禁用态这些真实交互。
- 窄屏与大字号下会不会遮挡、截断。
- **`app.wxss` 用了 CSS 自定义属性（`var(--ink)` 等）**，需要基础库支持。若开发者工具里颜色全部失效，第一件事就是查这里。

其余未验证项：服务层与 `wx-storage.js` 的真机行为、云函数、云存储、AI 真实调用、双账户隔离。

以上各项均不得在未执行的情况下勾选 `tasks.md` 中对应条目——所以 3.1—3.4 全部**保持未勾选**，只在描述里注明「代码已完成，待开发者工具验收」。

## 2026-09-22 · 长按操作面板与收起行（任务 3.6）

### 做了什么

- 长按一条补充 → 底部面板：「修改」「合并进灵感」「删除」，各带一句后果说明。
- 删除走**自定义确认弹窗**：正文写明「此操作无法撤销」，并**把待删内容放进一个带时间的框**——让「要删的就是这条」连起来，不是两句不相干的话。
- 已收起的补充长按**只给「恢复」与「删除」**，不提供修改：它们已经不在时间线上正常显示，先恢复再改，用户才看得清自己在改什么。

### 做的时候发现必须先解决的一件事

**`合并进灵感` 会让补充从时间线上消失，而当时没有任何入口能看到它。**

按规范，默认隐藏 + 没有入口就等于删除——那条承诺「你说过的话不会被悄悄抹掉」会被这个操作自己推翻。所以「N 条已并入灵感 · 展开」这一行是同一个任务的**必要部分**，不是附加项。已一并实现：收起行、展开、逐条恢复。

两种收起的措辞也做了区分：AI 汇总的写「已合并」，合并进灵感的写「已并入灵感」。只写「合并」两个字的话，用户分不清并到哪去了——这条规矩此前写在规范里，现在落到代码上了。

### 验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 通过：150 项，pass 150 / fail 0（本轮未改代码，只改页面） |
| 结构检查 | `npm run check` | 通过：`PASS 61 syntax/config/page checks.` |
| 规范校验 | `npm run openspec -- validate --all --strict` | 通过：1 passed, 0 failed |

覆盖率：87 条场景中已覆盖 46、部分覆盖 7、待验收 5、待实现 29。

### 未验证项（仍然）

- **长按手势本身没有在真机或开发者工具里试过。** `bindlongpress` 能不能正常触发、遮罩会不会挡错层级、面板与弹窗的 `z-index` 对不对——全部未验。
- 五个页面的 WXML/WXSS 编译与渲染、页面间跳转、窄屏与大字号，仍未验（同上一节）。
- 云函数、云存储、AI 真实调用、双账户隔离。

以上各项均不得在未执行的情况下勾选 `tasks.md` 中对应条目。

## 2026-09-22 · 补一份待用户提供的清单

用户此前要求「需要我提供的内容，先留占位符，最后我一起提供」。当时的处理只有代码里的占位值（`touristappid`、`envId: ''`），**没有一处能让人一次交齐的地方**。已补 `docs/PENDING-INPUT.md`，按凭据 / 决策 / 素材三类列出，并写清每一项「不给会怎样」。已挂进 `detailed-design.md` §0 的文档地图。

这份清单是流程产物，不改变任何代码或规范。

## 2026-09-22 · 长按面板、照片、AI、服务端协议（大轮）

用户指示「继续开发，不需要我提供的内容都开发完」。本轮把**所有不依赖凭据的部分**做完：照片本地环节、上传与删除联动、AI 调用与降级、服务端协议与仓库层、灵感级汇总编排，以及云函数入口与构建同步。

### 一条贯穿全轮的做法

**凡是需要外部资源的接口，一律从外面注入。** 存储、上传、模型调用、数据库、云存储清理——全部如此。

理由不是架构洁癖：规范里占一半的场景是**降级路径**（离线、配额耗尽、权限被拒、超时、额度耗尽、删除确认失败），这些在真机上很难稳定复现。注入之后，它们全都能在 Node 里直接断言。

### 新增模块

| 模块 | 职责 |
| --- | --- |
| `core/merge.js` | 灵感级汇总编排——**补上了覆盖率表指出的那条真实缺口** |
| `services/photo.js` | 权限、选图、压缩、上限校验（上传不在这里） |
| `services/upload.js` | 上传幂等与云存储清理 |
| `services/ai.js` | AI 调用与四条降级路径 |
| `server/repository.js` | 账户文档读写、幂等、冲突、代际、删除原子性 |
| `server/protocol.js` | 动作分发、身份、传输层幂等 |
| `cloudfunctions/linggan_ai/` | AI 云函数入口（**模型调用是占位**，厂商未定） |
| `scripts/build-cloud.cjs` | 把 `server/` 与 `core/` 同步进云函数目录 |

### 构建同步：一个容易被忽略的坑

微信云函数部署时**只上传函数目录本身**，所以共享代码必须有一份副本在里面。源码改了忘了同步，本地测试全过、线上跑旧代码——**这种错两边都能跑，不核对照不出来**。

`scripts/build-cloud.cjs` 负责同步，`npm run check` 核对一致，并把三类问题分开报：副本缺少、副本超出（**源里已删的过期代码**，本地测试看不见、线上可能被 require 到）、内容不同。

**已实测会红**：改一行 `server/protocol.js` 后，`npm run check` 立即报「内容不同：linggan_api/server/protocol.js」。

`linggan_ai` 同步的是**与客户端同一份 `core/`**，不是重写一套校验规则：两边规则一旦分叉，就会出现「客户端认为安全、服务端认为不安全」这种极难排查的问题。

### 闸门在这一轮拦了三次

| 拦下的 | 性质 |
| --- | --- |
| `services/ai.js` 里写了「记录、补充与浏览不受影响」 | **我自己禁掉的措辞，自己又写了一遍**。规范要求的是「基础功能继续可用」这个行为，不是让界面去念功能矩阵 |
| `cloudfunctions/linggan_ai` 里写了「AI 能力尚未接入」 | 开发阶段自述，属于注释不属于产品文案 |
| 覆盖率表里引用了一个**不存在的测试名**「契约」 | **最值得记的一条**：标「已覆盖」时人会顺手写一个看起来合理的测试名。没有闸门的话，这张表会慢慢变成一份自我安慰 |

另有 `emptyAccount` 导出了没写进详设、文档里「实例方法」被当成「模块导出」等结构问题，也是闸门报出来的。

### 验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 通过：**232 项**（上一轮 150 + 新增 82），pass 232 / fail 0 |
| 结构检查 | `npm run check` | 通过：`PASS 87 syntax/config/page checks.`（含云函数副本一致性） |
| 规范校验 | `npm run openspec -- validate --all --strict` | 通过：1 passed, 0 failed |
| 构建同步 | `node scripts/build-cloud.cjs --check` | 通过：副本与源码一致 |

覆盖率：87 条场景中已覆盖 61、部分覆盖 6、待验收 9、待实现 11。**云端与领域层已经没有空的**，剩下的 11 条集中在页面交互层。

### 未验证项（这一轮的重点）

**这一轮写的全是逻辑，没有一行在真机或开发者工具里跑过。** 具体没验的：

- **`wx.*` 的绑定是零验证的**：`services/wx-storage.js`、`services/photo.js` 注入的真实 `chooseMedia` / `compressImage`、`services/upload.js` 注入的 `uploadFile`、云函数里的云数据库与 `cloud.deleteFile`——**全部只有 `npm run check` 的语法检查兜底**。注入式设计的代价就在这里：逻辑可测，绑定不可测。
- **`linggan_ai` 的模型调用是占位**。厂商未定（`PENDING-INPUT.md` 2.1），未配置密钥时返回 `AI_DISABLED`，**不会伪造结果**。
- 账户维度的额度限制未实现（需要服务端计数器存储）。
- 五个页面的 WXML/WXSS 编译、跳转、交互，仍未验。
- 云函数未部署、集合未创建、云存储权限规则未配置、AI 未启用。
- 双账户隔离、断网上传、权限拒绝等真机验收。

以上各项均不得在未执行的情况下勾选 `tasks.md` 中对应条目。

## 2026-09-22 · 填入 AppID，补上最后一个 wx 绑定

用户提供了小程序 AppID。顺带把 `store` 的 `transport` 补上——它一直传的是 `null`，因为 `wx.cloud.callFunction` 的适配器还没写。

### 变更

| 项 | 内容 |
| --- | --- |
| AppID | `touristappid` → **`wxed8fdc5d559d973d`**，写入 `project.config.json` |
| 新增 | `miniprogram/services/wx-transport.js`——`wx.cloud.callFunction` 的适配器 |
| `app.js` | `transport` 改为按 `cloud.enabled` 选择：未启用传 `null`（保存跳过同步），启用后用真实传输层 |
| `store.js` | `enqueue` 改为返回 `{ queue, requestId, enqueuedAt }`；`requestId` **在入队时定下并随队列持久化**，重试同一条队列项时复用它——服务端的传输层幂等才成立 |

`wx-transport` 只做三件事：拼信封、发出去、把结果原样带回。**不重试、不降级、不解释错误码**——那些是 store 和页面的事。这一层跨在 wx 边界上，是**最不可能被测到的一层**，所以逻辑越少，出错的面越小。`callFunction` 仍做成可注入的，好把「云函数返回了畸形结果」这条路径也测到。

### 验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 通过：242 项（原 232 + 传输层 9 + 队列 1），pass 242 / fail 0 |
| 结构检查 | `npm run check` | 通过：`PASS 90 syntax/config/page checks.` |
| 规范校验 | `npm run openspec -- validate --all --strict` | 通过：1 passed, 0 failed |

### 未验证项

- **AppID 换掉了，但项目一次都没在开发者工具里打开过。** 颜色是否正常（`app.wxss` 用了 CSS 变量）、五个页面能否跳通、保存能否落本机——全部未验。
- `wx-transport` 的注入测试通过，但**真实的 `wx.cloud.callFunction` 调用一次都没发出去过**（云未启用）。
- 云环境 ID 仍为空——这是下一步的阻塞项，在开发者工具里开通云开发后即可拿到。

以上各项均不得在未执行的情况下勾选 `tasks.md` 中对应条目。

## 2026-09-22 · 填入云环境 ID，写出部署手册

用户提供了云开发环境 ID。**填了 ID，但没有翻开关**——这是有意的，理由见下。

### 变更

| 项 | 内容 |
| --- | --- |
| 云环境 ID | `''` → **`cloud1-d6g4hu8txdd86e48c`**，写入 `miniprogram/config/cloud.js` |
| `enabled` | **保持 `false`** |
| 新增 | `docs/DEPLOYMENT.md`——从开通云开发到翻开关的完整清单，每步带验证方法 |
| `tests/skeleton.test.cjs` | 原先断言「骨架阶段不得填写云环境 ID」，已不成立。改为守真正的不变量：**开关一旦打开，envId 就不能是空的** |

### 为什么不翻开关

资源和函数还没在控制台里建出来。提前翻的话，应用每次保存都会去调一个不存在的云函数：**界面仍能用**（降级成「已保存。还没同步到云端」），但日志里一直报错，而真正的失败原因被那条降级提示盖住了。

顺序不能反：**先部署、再翻开关**。`tests/skeleton.test.cjs` 现在会挡住「envId 还空着就翻开关」这种情况，但挡不住「资源没建就翻」——那只能靠部署清单和验收，闸门管不到。

### 部署手册里两条最容易漏的

1. **部署前必须跑 `node scripts/build-cloud.cjs`。** 云函数只上传自己的目录，共享代码靠脚本同步进去。忘了这步，上传的是上一次同步的旧代码——**而它照样能跑**，只是行为不对。
2. **集合权限必须选「所有用户不可读写」。** 选「仅创建者可读写」的话，客户端身份来自它自己声明的 `_openid`，而规范要求「客户端提供的身份字段不得授予访问权」。只有云函数能碰这个集合，身份才不可能被伪造。

### 验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 通过：243 项，pass 243 / fail 0 |
| 结构检查 | `npm run check` | 通过：`PASS 90 syntax/config/page checks.` |
| 规范校验 | `npm run openspec -- validate --all --strict` | 通过：1 passed, 0 failed |

### 未验证项

- **云端一步都没走。** 集合没建、权限没配、函数没部署、存储规则没设——全部待按 `docs/DEPLOYMENT.md` 执行。
- 项目仍未在开发者工具里打开过（见上一节）。
- 部署后的四项验收（双账户隔离、伪造身份被拒、删除闭环、离线重试）全部未做。

以上各项均不得在未执行的情况下勾选 `tasks.md` 中对应条目。

## 2026-09-22 · 小程序改名为「灵感拾光簿」

### 改了哪些

| 位置 | 内容 |
| --- | --- |
| `project.config.json` | `projectname`、`description` |
| `miniprogram/app.json` | 导航栏标题 |
| `miniprogram/app.js` | 两条 console 日志的前缀 |
| `miniprogram/app.wxss` | —— |
| `docs/ui-mockup.html` | 文档标题 + 8 个导航栏（**原型里的导航栏就是应用真实的导航栏标题，必须一起改**） |
| `package.json`、`cloudfunctions/*/package.json` | description |
| `README.md`、`AGENTS.md` | 标题与项目定位 |
| `openspec/config.yaml` | 项目上下文里的项目名 |

### 改了名字，但没改这两个

**一、能力名「灵感记录与补充」。** 它是 `inspiration-capture` 这个能力的中文描述，说的是**功能**（记录灵感这件事），不是项目名。同类还有 `detail.md` 里的「物理移除该条灵感记录」——那是「灵感 + 记录」两个词的组合。全仓检索确认：剩下的「灵感记录」只剩这两类，改掉反而读不通。

**二、`linggan_` 前缀。** 集合 `linggan_accounts`、云函数 `linggan_api` / `linggan_ai`、云存储前缀 `linggan/` 全部保持不动。

理由：前缀的用途是「辨识本项目资源、与其他小程序隔离」，而 `linggan`（灵感）描述的正是这个产品的题材——改的只是后缀（记录 → 拾光簿）。而且它已经写进了 `design.md`、`database-design.md`、协议层与一批用例，改名要动的是**跨系统的标识符**，不是显示名。

**现在改还是免费的**（资源一个都没建、函数一个都没部署）。如果你希望前缀也跟着换，说一声——但它不影响任何显示，也不影响用户看到的东西。

### 名字里的那个字

用户最初写的是「灵感拾光**薄**」，已按原样填入并当场标注了疑问。用户随后确认是「**簿**」（笔记本的簿），已全局替换 11 个文件。

它只出现在**显示名**里，不涉及任何标识符——所以这一次替换是纯文本的，不需要重新部署或迁移。

### 随后发现：改完名字，导航栏没变

用户在开发者工具里打开后指出，顶部仍显示「记录灵感」。

**原因**：`app.json` 的 `window.navigationBarTitleText` 只是**全局默认值**，任何页面在 `pages/*/index.json` 里设了自己的标题就会把它盖掉。三个 tab 页各自设过标题，所以全局那个从来没生效过。

**更值得记的是**：`docs/ui-mockup.html` 里画的导航栏一直是**小程序名**，而代码里是功能名——**原型与代码早就分叉了，没有任何东西会发现**。这正是此前反复说明的「闸门管不到界面与原型」的实例。

### 处理

| 项 | 内容 |
| --- | --- |
| tab 页（记录 / 灵感 / 我的） | 导航栏标题改为**小程序名**。tab 栏已经标了区块名，导航栏重复它是冗余；页面功能由**页内标题**承担（「记下这一句」「我的灵感」「我的」） |
| 二级页（灵感详情 / 历史版本） | **保持功能名**。它们没有 tab 标签，导航栏必须回答「我在哪」 |
| `docs/ui-design.md` §1 | **补上导航栏标题的规定**——此前根本没写过，这正是分叉的根源 |
| `tests/skeleton.test.cjs` | 新增用例「小程序名在导航栏里处处一致」 |

### 这一类其实是能机械检查的

我此前说「闸门管不到界面与原型」，那条对**布局与视觉**成立，但对**可枚举的配置**不成立。新用例守三条：

1. `app.json` 的全局窗口标题 === `project.config.json` 的 `projectname`
2. 每个 tab 页的标题 === 小程序名
3. 每个二级页的标题 !== 小程序名

**已实测会红**：把记录页标题改回「记录灵感」，测试立即报
`pages/capture/index 是 tab 页，导航栏标题应当是小程序名`。

### 验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 通过：244 项，pass 244 / fail 0 |
| 结构检查 | `npm run check` | 通过：`PASS 90 syntax/config/page checks.` |
| 规范校验 | `npm run openspec -- validate --all --strict` | 通过：1 passed, 0 failed |

### 未验证项

- **这一次仍是用户在开发者工具里发现的，不是自动化发现的。** 新用例能挡住同一类问题再次发生，但挡不住别的「原型画了、代码没跟上」——那些仍然靠人比对。
- 其余未验证项同前几节。

以上各项均不得在未执行的情况下勾选 `tasks.md` 中对应条目。

## 2026-09-22 · 闸门的行尾 bug：一次 checkout 之后 5 项测试变红

### 发生了什么

合并到 `main` 时，`git checkout main` 把工作区文件从 LF 转成了 CRLF（仓库的 `core.autocrlf` 是 `true`）。切过去之后跑验证，**244 项里 5 项失败**——而同一份内容在 `dev` 上刚刚还是全绿的。

失败的是 `design-contract` 的四个字段核对，和 `spec-coverage` 的对齐核对。

### 根因

**JavaScript 里 `.` 不匹配 `\r`。**

闸门里有这类正则：

```js
/^#### Scenario: (.+)$/          // spec-coverage 读规范场景
/^\|\s*`([A-Za-z0-9_]+)`\s*\|(.+)$/   // design-contract 读字段表
```

文件是 LF 时，`(.+)$` 正常。文件是 CRLF 时，行尾多一个 `\r`，`(.+)` 吃不掉它，`$` 又匹配不到它前面——**整行失配，闸门静默失效**。

### 这件事真正值得记的地方

**在此之前所有「闸门全过」的结论，都建立在一个偶然状态上：工作区恰好是 LF。**

那些文件是我用工具写的，写出来就是 LF；而任何一次 `git checkout` 之后它们都会变成 CRLF。**换句话说，这几道闸门从建起来到现在，从来没有在 CRLF 上真正跑过。** 它们一直"跑得很正常"，只是没在干活。

如果这次没有合并到 main、没有触发 checkout，这个 bug 会一直潜伏到某天换机器或重新 clone 之后才炸——而那时更容易被误判成"代码坏了"。

### 修法

两个测试文件各加一个 `lines(text)` 辅助函数，按 `/\r?\n/` 切分。**不是把正则改得更聪明，而是先把行尾归一化掉**——这样后面所有解析都不用再操心这件事。

### 验证（两种行尾都实测过）

| 工作区行尾 | 命令 | 结果 |
| --- | --- | --- |
| CRLF（checkout 之后的默认状态） | `npm test` | 通过：244 项，pass 244 / fail 0 |
| LF（手工把 docs 与 openspec 转回 LF） | `npm test` | 通过：244 项，pass 244 / fail 0 |

**没有只靠推理说"LF 也应该行"**——刚因为这种假设栽过一次，所以两种都真跑了一遍。

### 未验证项

- 这次修复本身只覆盖了会读文件的闸门。`scripts/check.cjs` 与 `build-cloud.cjs` 读文件只做内容相等比较，不受行尾影响；`copy-rules` 用的是 `indexOf`，也不受影响。这三处**未单独构造两种行尾验证**。
- 其余未验证项同前几节。

以上各项均不得在未执行的情况下勾选 `tasks.md` 中对应条目。

## 2026-09-22 · 打开云开关

用户要求把 `config/cloud.js` 的 `enabled` 改为 `true`。

### 我此前的判断是错的

我拦过一次，理由是「资源和函数还没建出来，提前翻会让每次保存都去调一个不存在的云函数，而失败原因被降级提示盖住」。

**其中一句话不成立**：「被降级提示盖住」——那条提示写的是「已保存。还没同步到云端，会自动重试」，说的正是真实状态，没有掩盖什么。

**更根本的问题是**：我假设了「资源和函数还没建出来」，**而这个假设我从没核实过**。用户能拿到环境 ID，就说明环境已经存在；集合和函数建没建，我在代码里看不出来，也没问。**用一个没核实的假设去拦一个明确的指令，是错的。**

### 变更

| 项 | 内容 |
| --- | --- |
| `config/cloud.js` | `enabled: false` → **`true`**，注释重写为「打开后如果每条都显示还没同步，先查控制台而不是客户端代码」 |
| `tests/skeleton.test.cjs` | 删掉「云开关须为 false」这条断言——**它编码的正是被推翻的那条政策**。保留「打开时 envId 必须已填」 |
| `AGENTS.md`、`README.md`、`openspec/config.yaml`、`proposal.md` | 四处「默认关闭」的现状描述已过期，一并更新 |
| `docs/DEPLOYMENT.md`、`docs/PENDING-INPUT.md` | 第 8 步「翻开关」标为已完成，并写明**开关打开不等于云端就绪** |

### 那条断言的取舍

原来的断言是「不能通过直接改开关生效」这条规则的代码形式。现在用户明确要求打开，规则不再成立，所以删的是**断言**而不是**事实**：闸门从此只守「别在 envId 空着的时候翻开关」，挡不住「函数没部署就翻」——那两样在代码里看不出来。

这个边界写进了 `skeleton.test.cjs` 的注释和 `DEPLOYMENT.md`：**打开后如果每条保存都显示「还没同步到云端」，先查控制台的函数与集合。**

### 验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 通过：243 项（合并了两条开关用例，故比上轮少 1），pass 243 / fail 0 |
| 结构检查 | `npm run check` | 通过：`PASS 90 syntax/config/page checks.` |
| 规范校验 | `npm run openspec -- validate --all --strict` | 通过：1 passed, 0 failed |
| 开关状态 | `node -e` 读配置 | `cloud.enabled: true`、`envId` 已填、`ai.enabled: false` |

### 未验证项（这一步最要紧）

- **云端是否真的就绪，代码看不出来。** 集合、权限规则、唯一索引、两个云函数、云存储规则——全部待用户在云开发控制台确认。
- **`wx.cloud.init` 与 `wx.cloud.callFunction` 一次都没真的跑过。** 翻开关只改了配置值，真正的调用要等开发者在工具里打开。
- 其余未验证项同前几节。

以上各项均不得在未执行的情况下勾选 `tasks.md` 中对应条目。

## 2026-09-23 · 内容复制、整理与留档

用户授权开发从记录到使用的完整文本出口。新增 `add-content-output` 独立提案与规范；详情页提供正文/正文与当前补充/单条补充复制，新增整理与留档页，使用稿可编辑、复制并在 2000 字内另存为新灵感，原记录不变。留档包含现存正文、补充及修改历史；TXT 由用户显式生成，再由用户显式选择发送，页面离开时尽力清理临时文件。不含照片或已删除补充。

自动验证：`npm test` 263/263 通过；`npm run check` 98 项通过；`npm run openspec -- validate --all --strict` 2 项通过；`git diff --check` 通过。纯文本选择、格式化、另存失败、复制失败、TXT 生成/发送失败、临时文件清理和个人内容页面禁止索引均有 Node 测试。

未验证：微信开发者工具真实 WXML/WXSS 编译与渲染，系统剪贴板权限及提示，iOS/Android 上 `wx.shareFileMessage` 的选择/取消/发送结果，云备份真实状态。尝试只读抓取开发者工具窗口时返回的画面混入 Codex 界面，无法形成可靠证据，未继续点击或输入。Node 测试与结构检查不等于这些平台验收；未部署、未提交、未发布。

## 2026-09-23 · 产品审阅整改首批

范围：根据 `docs/PRODUCT-REMEDIATION-20260923.md` 调整记录、列表、详情和「我的」页的现有体验；修正设计文档与列表展示口径。建立 `repair-cloud-sync` 待审阅提案，**未实施同步协议、未迁移本机数据、未操作云端**。

| 项目 | 命令 / 证据 | 结果 |
| --- | --- | --- |
| 页面与文案 | 当前 WXML/WXSS/JS + `tests/ui-remediation.test.cjs` | 补充输入提前；列表只计有效补充；记录与「我的」说明实际可用的后续操作 |
| 单元测试 | `npm test` | 通过：266 项，0 失败；新增 3 项覆盖本轮列表、详情和「我的」调整 |
| 结构检查 | `npm run check` | 通过：98 项；不等于 WXML/WXSS 真实编译 |
| 规范校验 | `npm run openspec -- validate --all --strict` | 通过：3 项变更；`repair-cloud-sync` 的 10 条场景仍全部待实现 |

代码核对发现的未解决风险：客户端推送没有 `baseVersion`，服务端缺字段时跳过版本检查；待同步队列没有重试调度；全局本机键没有可信账户分区；客户端删除未调用服务端 `inspiration.delete`，因此不能据现有路径声称已清理云端照片。这些已写入提案与覆盖率表，**未标为修复完成**。

未验证：微信开发者工具的真实编译/渲染、320/375/430 宽度和大字号、iOS/Android 真机、云资源及权限、两账户隔离、离线恢复与照片删除闭环。未部署、未提交、未发布。

## 2026-09-23 · 云同步整改代码阶段

用户要求继续后，仅在 `dev` 工作区实施 `repair-cloud-sync` 的代码与文档，不触碰真实账户数据。启动及回到前台先通过 `snapshot.pull` 取得可信账户作用域，再打开 `linggan:v2:<cacheScope>:state`。旧 `linggan:v1:*` 键不读取正文、不展示、不迁移、不删除；若检测到旧键，仅提示用户保留数据。新分区用单键原子保存快照和待处理操作；推送携带必填版本与代际，重试复用请求标识；冲突停止自动写入并保留本机及云端文字快照。无照片删除改走独立动作，确认前不移除本机记录。服务端使用版本条件写入；含照片删除在安全清理协议完成前拒绝，未伪装成已清理。

| 项目 | 命令 / 证据 | 结果 |
| --- | --- | --- |
| 账户隔离、重试、版本、删除 Node 用例 | `npm test` | 263/263 通过，0 失败；包含前台重新验身份、缓存分区、原子写入、并发版本门控与含照片拒绝 |
| 云函数副本 | `node scripts/build-cloud.cjs` | 同步 10 个文件到函数目录；未上传云端 |
| 结构检查 | `npm run check` | 99 项通过；不等于 WXML/WXSS 真编译或渲染 |
| 规范校验 | `npm run openspec -- validate --all --strict` | 3 项变更通过 |
| 差异格式 | `git diff --check` | 通过；仅有 Git 的 LF/CRLF 提示 |

**未完成且不能据此发布：**旧全局缓存真实归属、备份与恢复界面；冲突后的人工选择/合并；含照片删除的部分成功恢复协议；旧客户端与新版服务端的兼容期；云集合与唯一索引实际状态；云函数部署；微信开发者工具真实编译渲染；两账户、两设备、弱网、iOS/Android 真机验收。首次启动或回前台时若无法联网确认可信身份，暂不展示缓存或接受持久化，输入框保留文字；这是当前隔离优先的限制，不能宣传为完整离线体验。尚未提交、推送、合并或发布。

## 2026-09-24 · 旧数据确认与冲突恢复

用户确认旧版小程序没有须保留的真实记录。仍不自动读取、展示、迁移或清理 `linggan:v1:*`，以免误动测试缓存。本轮为冲突增加用户确认的恢复路径：重新拉取当前可信账户云端快照，将本机冲突快照和未确认操作原子追加到同账户的只读 `recoveries[]`，成功后才切换活动快照；恢复副本持久可查看、可复制，不自动回传或删除。若写入失败、作用域不符或本机内容含照片，则保持原冲突与队列。无冲突时恢复动作被拒绝。前台网络恢复事件再触发一次有界重试；后台不发起，身份未确认时先重新拉取，不凭旧缓存键解锁。

| 项目 | 结果 |
| --- | --- |
| `npm test` | 270/270 通过，0 失败；新增恢复副本、失败保留、跨账户隔离、照片阻断和确认界面用例 |
| `npm run check` | 100 项结构检查通过；云函数副本与根源码一致 |
| `npm run openspec -- validate --all --strict` | 3 项变更通过 |
| `git diff --check` | 通过；只有 Git 的 LF/CRLF 提示 |
| 分支 | `dev` 与已抓取的 `origin/dev` 无提交差异；工作区原有未提交改动均保留 |

**仍未验证：**微信开发者工具真实 WXML/WXSS 编译与渲染、真机账户切换及弱网、实际云数据库唯一索引与条件写、云函数部署、老客户端兼容。含照片删除继续拒绝；云存储逐项删除可能部分成功，尚无可保证恢复的协议。首次启动或回前台离线时仍会因无法确认可信账户而暂停展示与保存。未提交、未推送、未部署、未发布。

## 2026-09-24 · 请求幂等与重试安全修复

本轮针对两设备同账户可能产生相同 `requestId` 的风险，改为在入队时使用含随机量的标识；服务端将成功缓存与动作、参数摘要绑定。同标识提交不同操作返回 `REQUEST_ID_REUSED`，本机保留队列并停止自动重试；同标识、同内容的并发调用在实例内共用结果。暂时性错误不缓存，原标识可以重试。文档与 `backup-recovery` 规范新增两条场景，未改动真实云数据。

| 项目 | 结果 |
| --- | --- |
| 定向单测 | `node --test tests/server.test.cjs tests/store.test.cjs`：43/43 通过 |
| 全量单测 | `npm test`：275/275 通过，0 失败 |
| 云函数副本 | `node scripts/build-cloud.cjs`：同步 10 个文件；只更新本地副本，未部署 |
| 结构检查 | `npm run check`：100 项通过；不等于真实 WXML/WXSS 编译或渲染 |
| 规范校验 | `npm run openspec -- validate --all --strict`：3 项通过 |
| 差异检查 | `git diff --check`：通过；有 Git LF/CRLF 提示 |

仍需微信开发者工具和真机验证、核对云资源与旧客户端兼容。含照片删除保持安全拒绝，未部署、未提交、未推送、未发布。

## 2026-09-24 · 分享、朋友圈文字海报与意见反馈本地代码阶段

用户授权继续开发 `add-sharing-feedback`。已加入选择当前文字后确认分享、好友只读页、本人分享列表与撤销、公共小程序分享入口、分页文字海报及小程序码/相册保存入口、意见反馈与分享举报。服务端从可信账户读取快照并排除照片与历史，只保存令牌哈希及可轮换密钥加密的令牌；读取时检查过期、撤销、源记录与账户代际。新增集合仅在云函数侧访问，客户端不直连。创建分享默认由 `LINGGAN_SHARE_CREATE_ENABLED=false` 关闭；没有审核或密钥时失败关闭。并发插入回退路径也会重新核对分享有效性，避免返回已撤销令牌。

| 项目 | 结果 |
| --- | --- |
| `npm test` | 296/296 通过，0 失败；包含服务端分享/反馈、协议缓存失效、页面状态、海报分页与模拟绘制 |
| `node scripts/build-cloud.cjs` | 根源码同步 12 个文件到本地云函数目录；未上传云端 |
| `npm run check` | 133 项语法、配置、页面结构检查通过；不等于真实 WXML/WXSS 编译 |
| `npm run openspec -- validate --all --strict` | 4 项变更通过 |
| `git diff --check` | 通过；仅有 Git 的 LF/CRLF 提示 |

**仍不能对外开放或宣称完整运行：**`linggan_shares`、`linggan_feedback` 的创建、索引和全拒绝权限未在云端验证；审核云调用与小程序码的真实 SDK 返回、密钥轮换、跨实例原子限流、保留期清理任务尚未完成受控验收。微信开发者工具的 WXML/WXSS 编译与渲染、聊天分享和朋友圈手动发图、相册授权与多页保存、两账户越权、iOS/Android 真机均未验证。既有 `repair-cloud-sync` 的兼容/含照片删除限制也仍是部署前置条件。本轮未部署、未提交、未推送、未合并或发布。

## 2026-09-27 · 分享创建默认启用

按用户“能开启的开启”的要求，`linggan_api` 入口在 `LINGGAN_SHARE_CREATE_ENABLED` 未设、空串或 `true` 时允许进入创建流程；`false` 或无效值暂停新建。保留服务端密钥、可信身份、来源版本、配额、内容审核与存储检查；显式暂停不影响已有分享的读取、撤销和意见反馈。云备份、公共小程序分享入口和意见反馈原先未关闭，本轮不重复修改。AI 的 `callModel` 仍返回占位结果，保持关闭。

| 验证 | 结果 |
| --- | --- |
| 分支同步 | 已抓取 `origin/dev`，与 `dev` 无提交差异；保留原有工作区改动 |
| `npm test` | 299/299 通过；新增真实入口脚本的开关解析测试、暂停后读取/撤销/反馈测试、启用后审核失败拒绝测试 |
| `npm run check` | 134 项通过；本轮未修改 `server/` 或 `miniprogram/core/`，现有副本一致性通过 |
| OpenSpec 严格校验 | 4 项变更通过 |
| `git diff --check` | 通过，仅 Git LF/CRLF 提示 |

本轮只更新本地源码及文档，未修改线上环境变量或部署云函数。云端是否已配置密钥、集合、索引和权限尚未核实，不能写成已配置或确定缺失；线上若显式配置 `false`，新代码默认值不会覆盖它。真实分享、海报、审核云调用及真机仍待验收。未提交、未推送、未发布。

## 2026-09-27 · 剩余产品工作流本地实现与收尾

### 交付范围

1. 按用户“先提交到 dev”的授权，前一批 112 个文件提交为本地 `ebb243a`（文字出口、分享反馈与账户同步整改）。未推送。下述新开发全部保留工作区，尚未再次提交；未纳入 `.claude/settings.local.json`。
2. 分享/反馈原子配额、所有公开动作限流、撤销释放额度、默认演练的保留期清理。新增 `linggan_maintenance` 无自动触发器，未部署或执行真实清理。
3. 正文/有效补充/标签搜索、阶段与已合并筛选、每日固定回顾、五种用途模板与重新生成保护、标签阶段编辑、自愿设备统计。统计默认关闭，不含正文或搜索词，不自动上传。
4. 照片压缩、确定对象路径、持久化暂存、跨实例重试、放弃清理、私有预览、单张/整条分步删除以及照片冲突恢复。文件部分删除后保留进度，不承诺物理回滚；真实权限未验收前不开放能力。
5. CloudBase AI SDK 适配器、账户日/分钟额度、输入输出审核及契约校验、草案逐条采纳/编辑/放弃、补充/多灵感汇总、覆盖目标确认、来源追溯与恢复、一次批量保存。仍关闭 AI，未产生真实模型调用或费用。
6. 新记录结构校验与合并无环、原历史不可改写；会话草稿按账户隔离。旧实例在会话失效后不能继续发队列或确认迟到结果，照片上传切换时留原任务。

### 自动验证

| 项目 | 本轮结果 | 证明范围 |
| --- | --- | --- |
| `npm test` | 334/334 通过，0 失败 | 纯函数、注入式数据库/平台适配器、页面协议与一致性闸门 |
| `node scripts/build-cloud.cjs` | 同步 36 个共享源码文件到本地函数目录 | 已核验目标均位于本仓库 cloudfunctions 下；无云上传 |
| `npm run check` | 195 项通过 | 语法、JSON、页面文件与副本一致性；不是原生渲染验收 |
| `npm run openspec -- validate --all --strict` | 5 项变更通过 | 规范格式与变更结构 |
| `git diff --check` | 通过 | 差异空白检查 |

新增重点用例在 `production-readiness.test.cjs`、`discovery.test.cjs`、`ai-workflows.test.cjs`、`photo-workflows.test.cjs`、`usage-metrics.test.cjs`、`record-validation.test.cjs`。账户切换与迟到回执另见 `store.test.cjs`、`app-account.test.cjs`。公开分享逐块审核见 `sharing-config.test.cjs`。

### 开发者工具编译与截图

生成独立工程 `qa/local/inspiration-workflows`，入口替换为 `tests/fixtures/devtools-app.js` 的内存样例，不初始化云服务，不读取或重放正式账户队列。`scripts/prepare-devtools-fixture.cjs` 可重新生成；这是测试工程，不是生产配置。

- 真实 WXML 编译最初发现分享列表/海报条件表达式把 `&&` 写成 HTML 实体，已修复两处并增加回归检查。最终 `compile_wxml` 成功，返回 codeLength=160772。
- 详情、整理与 AI 页面路径的 `compile_wxss` 调用均成功，各返回 comm/page 两项、totalCodeLength=16710。只按工具返回记录，不据此宣称所有设备样式已验收。
- 已保存并查看：`docs/evidence-development-20260927/01-list.png`、`02-detail.png`、`03-output.png`、`04-output-draft.png`、`06-ai-preview.png`、`07-photo-viewer.png`。列表筛选、详情操作、模板选项及主按钮的原生默认宽度问题已修正。截图尺寸 289×625，是模拟器输出，不是真机截图；04 是修正全宽按钮前的编辑稿状态。
- AI 预览明确标注“离线样例”，由运行时注入合成文字，只核验布局；没有模型生成。照片查看使用包内品牌图片，不是用户图片或云存储访问证明。
- 一次 AI 截图因热更新回到记录首页而超时；重新导航并核对 route 后取成功截图，失败结果未计入验收。`05-ai-disabled.png` 未作为有效关闭态证据；关闭行为由自动测试与配置核对，真机另验。

### 尚未完成的外部步骤

未部署函数或创建集合/索引；未核验正式存储权限、双账户/多设备隔离、旧客户端发布兼容、真实审核和小程序码、相册授权、朋友圈手动发布、真实 AI 输出/超时退款、真实图片删除、iOS/Android 键盘/大字号/读屏/弱网。清单和回退边界见 `DEPLOYMENT.md`、`PENDING-INPUT.md`。这些步骤须取得独立授权或外部条件，不能用本地通过结果替代。

会员、支付与通用撤回仍待权益/计费/恢复期限规则确认；热度排名继续暂缓，不计入本次已确认交付。没有归档 OpenSpec、合并 main 或发布。

## 2026-09-27 · 跨灵感手动选材整理补齐

### 实现与边界

复核优化方案发现 P2 手动跨记录选材仍缺少入口，本轮新增 `add-material-output` 提案、规范与详设 §16 后实施。列表进入“选材整理”，可从多条灵感分别选择正文及有效补充，支持搜索、只看已选及选择顺序号；取消后重选放到末尾。五类模板只套结构，不扩写、不调用 AI、不自动分享、不改动来源。

每次最多 40 段、20 条来源、合计 12000 字（含段间换行），生成时核对当前来源。删除、合并、收起或内容变化后拒绝生成，保留旧稿，可明确刷新再选。编辑后重新生成须确认。复制失败、保存失败或超出另存 2000 字上限时保留全文；保存成功后的同稿不重复写入。新增记录沿用既有普通记录结构，无新数据库字段、集合或迁移。

页面隐藏清空选材与草稿；返回重新读取。账户会话变化后清除旧内容、丢弃迟到确认/复制/保存回执。私人选材、AI 工作页与照片页补齐索引限制，其余未声明页面默认禁止索引，仅 welcome 公共入口允许；该配置不替代云端访问控制。

### 自动验证

| 项目 | 结果 | 证明范围 |
| --- | --- | --- |
| `npm test` | 345/345 通过，0 失败 | 本轮增加 material-output 的 11 项测试，包含字段白名单、边界、源变化、搜索保留选择、稿件保护、失败重试、会话隔离及索引 |
| `npm run check` | 202 项通过 | 语法、配置、页面完整性及既有云函数副本一致性 |
| OpenSpec strict | 6 项变更通过 | 提案及规范格式，六条新增场景与覆盖表对齐 |

本轮没有改动根 `server/` 或 `miniprogram/core/`，无需重新生成云函数副本；既有未提交文件原样保留。

### 开发者工具验证

继续使用 `qa/local/inspiration-workflows` 合成样例工程，不初始化云服务，不访问正式账户队列。微信工具版本与技能版本均为 0.3.9。

- 最终选材页 `compile_wxml` 成功，返回 codeLength=173044；`compile_wxss` 成功，返回 comm/page 两项、totalCodeLength=25453。局部编译结果不外推为真机或全功能验收。
- 从列表点击选材入口，默认 0 段；选择第一段后搜索第二条并选择，选中数为 2；点击生成后两段按选择顺序完整显示。
- 使用原生 textarea 输入合成稿，点击另存得到成功提示，点击查看进入新记录详情。保存目标为内存样例，不能据此证明真实云备份。
- 选材滚动位置为 422 时点击生成，稿件渲染后 `scrollTop` 回到 0；返回选材/当前稿件同样回页顶，避免长列表滚动位置遮住稿件操作。
- 临时令离线 store 读取抛错，页面独立显示错误和“重新读取”，不呈现正常空列表；恢复读取函数并点击重试后恢复 4 段素材。
- 核查截图并修正素材按钮默认粗体、返回选材对齐及读取失败展示。最终查看 `08-material-select.png`、`10-material-draft-final.png`、`11-material-error.png`；`09-material-draft.png` 记录两段合成稿的中间状态。图片均在 `docs/evidence-development-20260927/`，尺寸 289×625，保持 Git 忽略。
- `get_simulator_console` 的 `grep -i error` 返回空字符串，只说明无匹配错误日志。
- 首次运行时查询缺少 action 参数、两次带属性选择器点击返回 `no such element`，随后稿件截图等待超时；这些尝试不算通过。按帮助补齐参数、查询真实元素后，使用搜索及 `.option` 点击完成验证，未盲目延长等待。

### 仍未完成

真机剪贴板、键盘与大字号、后台返回/双账户、真实云保存及多设备并发仍待独立验收。整个项目的云资源核验、部署、真实照片和分享闭环、模型选择/预算/启用仍见 `PENDING-INPUT.md`；本轮没有执行这些动作。

已抓取 `origin/dev`，本地 dev 比远端领先原有 `ebb243a` 一个提交，远端无新增提交；本轮改动尚未提交、未推送、未部署、未合并 main。

## 2026-09-27 · 云资源只读核验

按用户同意的第一步，仅通过 wechatide 0.3.9 云资源工具查询元信息；没有启动生产页面、调用业务云函数、读取用户文档/照片或写云数据。详情见 `CLOUD-READINESS-20260927.md`。

- AppID 对应环境列表只有 `cloud1-d6g4hu8txdd86e48c`，与本地配置一致。
- 完整集合列表共四个，本项目只有 `linggan_accounts`；另外三个非本项目集合不继续查询或修改。`linggan_shares`、`linggan_feedback`、`linggan_usage`、`linggan_rate_limits`、`linggan_ai_usage` 缺失。
- 账户集合的 `accountKey_unique` 为 accountKey 升序、Unique=true、Sparse=false、无部分过滤，满足设计的业务唯一索引要求；权限没有返回，不能标为通过。
- 函数列表只有 API 与 AI，两者 Active、Nodejs16.13、timeout=3；维护函数缺失。AI 超时不满足本项目至少 60 秒的设计；Active 不证明线上代码与本地一致。
- 当前工具不提供规则读写动作，函数详情也没有环境变量、部署时间/版本、云调用权限；这些项目保持“未知”，不写成已配置或确定缺失。
- 结合本地源码确认先补资源再部署的必要性：新版 API 删除前撤销来源分享，分享集合缺失会阻断该流程；未在生产执行删除来验证。

本轮只新增核验文档并更新部署手册及待办，没有修改业务代码、创建资源、调整权限、执行清理、提交或推送。后续第一批建议仅补分享/反馈所需四集合与索引，并完成控制台权限核验；创建资源需要用户另行授权。

文档更新后回归：`npm test` 345/345 通过；`npm run check` 202 项通过；OpenSpec 严格校验 6 项通过；`git diff --check` 通过。上述结果不替代本节仍未知的云端权限或真实业务验收。

## 2026-09-27 · product 部署授权与本地准备

用户随后要求部署已有代码到正式环境 product，新增 `deploy-product-release` 提案、三条操作验收场景及覆盖表。环境查询首次因工具审批额度限制未执行；继续后只读查询成功，仅返回 `cloud1-d6g4hu8txdd86e48c`，没有名称，已请求用户确认与 product 的对应关系。没有待确认的云端写任务，也没有已启动的部署。

本轮 `git fetch origin dev` 成功，`origin/dev...HEAD` 为 0/1，保留全部未提交修改。校验四个生成目录都位于本仓库且路径及内容无重解析点后，运行 `node scripts/build-cloud.cjs`，重新生成 36 个副本；没有删除源文件或业务数据。

发布前本地结果：`npm test` 345/345，`npm run check` 202 项，OpenSpec 严格校验 7 项全部通过；`git diff --check` 通过。本轮不重复计入以前的模拟器截图，未进行真实云端或真机联调。

### 本地代码摘要（非线上版本证明）

算法：每个目录递归枚举普通文件，排除 node_modules，按相对路径排序；依次将相对路径（分隔符为 `/`）、NUL、文件原始字节、NUL 输入 SHA-256。不包含仓库根本机配置或 Git 状态；上传前如代码、环境配置或依赖发生变化，必须重算。

| 目录 | 文件数 | SHA-256 |
| --- | --- | --- |
| miniprogram | 93 | `95561d84a98b3eac2040b13471136ed20266a63f170fa085e482e7fb8b5dd7be` |
| cloudfunctions/linggan_api | 13 | `73ac3a5d5098527f7a490ed59fa299c7528f3140b018999ed0bc91c8ab4ab95c` |
| cloudfunctions/linggan_ai | 20 | `800fa4126447adf4930ff6172f45f9e869910a6ba37da0f22e6370f7e3af8eb7` |
| cloudfunctions/linggan_maintenance | 12 | `4eb9635a606d4f54ac509322cfde73a29dec41ac53ef0320434e23b40b3602e4` |

尚未创建集合/索引、调整权限/环境变量、部署云函数、上传小程序或公开发布；AI 与真实清理保持未启用。本地代码摘要不能代替线上恢复点，也不证明微信平台实际打包内容。修改尚未提交，未推送、未合并 main。

## 2026-09-27 · 正式共享环境更正与适配阻断

用户明确正式环境为 `product-d2g59zty74d7d1ec1`，资源方 AppID 为 `wx7ad85943fe81e095`；本小程序仍为 `wxed8fdc5d559d973d`。抓取 origin/dev 后仍为落后 0、领先 1；保留原有未提交开发。

- 用本小程序 AppID 查函数返回 `ResourceNotFound.Namespace`。数据库 listCollections/listIndexes 虽报告 success，却没有列表明细，checkCollection 对三个集合返回 exists=true；后续资源方完整列表与这些返回不一致，不能将其作为资源存在的依据。
- 用用户提供的资源方 AppID 查环境，明确包含 product。完整函数列表为 9 项（含共用 cloudbase_auth），无 linggan_api/linggan_ai/linggan_maintenance；完整集合列表 Total=5，无本项目六集合。只读取元信息，未查其他应用的记录或密钥。
- 本地仍用默认 wx.cloud 和旧环境，账户派生仅处理 APPID/OPENID，缓存未按环境分区。部署前需要共享连接、来源身份拒绝策略、环境缓存隔离和云调用 AppID 适配。设计、规范及待实现覆盖行已补齐，不代表实现完成。
- 检查官方 wx-server-sdk 2.6.3 包的公开源码，确认 openapi 代理支持 appid 配置，getWXContext 从平台上下文键读取；包只下载到已忽略的 qa/local/sdk-inspection，未安装、升级或执行包脚本。官方源码入口：https://github.com/wechat-miniprogram/wx-server-sdk 。此核验不替代实际共享权限和审核调用验收。
- 共享适配补丁被自动安全审查拦截：既有部署授权未明确包含认证和数据边界改造。工具拦截前已写入部分客户端文件，随后只撤回本轮新增文件和相关改动；server/wx-identity 未写入，云函数未改动。已明确告知用户此部分写入与撤回事实，未绕过拦截重试。
- 撤回后 345/345 测试、202 项结构检查、7 项规范校验通过，云函数副本校验及 git diff --check 通过。三个云函数代码摘要与前一节一致。客户端原始字节摘要为 `42ff3f47c44377fb288c784a0c3b9b9a701cad29512805adfd9e51409b2f7b6e`（93 文件）；补丁往返改变了部分文件换行格式，发布前应以重新计算的摘要为准。

本轮最终只保留文档与规范的更新；共享适配仍待明确授权。没有云端写入、函数部署、客户端上传、AI 调用、实际清理、Git 提交、推送或 main 合并。

## 2026-09-27 · 授权后的共享适配与首个创建确认

用户对四项适配及继续部署明确回复“是”。本轮在 dev 保留既有修改，抓取 origin/dev 后仍为落后 0、领先原有 1 个提交；未提交、推送或合并。

### 实现和本地验证

- 新增独立 Cloud 连接：资源方 `wx7ad85943fe81e095`，环境 `product-d2g59zty74d7d1ec1`；等待 init、并发复用、失败可重试、无默认/旧环境回退。项目 AppID 不变。
- API、AI 入口共用可信来源解析，完整 FROM_APPID/FROM_OPENID 仅接受本项目；不完整来源或其他项目拒绝，不能回退资源方身份。账户哈希公式不变。内容审核和小程序码显式绑定本项目 AppID。
- 本地快照、队列、照片暂存、回顾偏好和指标都经环境命名空间隔离；旧键保留，不自动读取、重放或迁移。
- 照片上传/删除/下载统一使用共享实例；详情和查看页仅下载当前环境当前账户路径，不生成公开 URL 或把临时路径写回记录。页面隐藏、重复加载或账户变化后不回填迟到结果。
- 新增 11 项共享测试（含实际入口注入测试），全套 `npm test` **356/356**；`npm run check` **210**；OpenSpec strict **7**；git diff --check 通过。验证生成目录范围/无重解析点后同步 **39** 个副本，一致性通过。
- 本轮修改了两处照片 WXML，真实编译/渲染尚未执行；旧离线截图不作为本轮证明。真实共享授权、审核、小程序码、两账户、私有文件读写和真机验收仍未完成。

### 云端查询和待确认任务

创建前重新以资源方身份读取：集合 Total=5、函数 Total=9，均无 linggan_ 资源。没有读取其他应用业务文档、修改共用认证或存储规则。

已发起唯一一笔云写请求：在 product 新建空集合 `linggan_accounts`。工具返回 success=true、status=pending、message=`Waiting for user confirmation.`；success 仅表示确认任务已建立，不代表集合已创建。任务 ID：`confirmation_cloud_db_write_struct_5e0105b9-6089-41b6-9faa-a52ede9a632c`。按 wechatide 技能暂停后续云操作，不主动轮询、不重发。用户确认并继续后先查询此 ID。

其余五集合、全部索引/权限、三个函数部署、客户端上传和公开发布均未发起；AI、照片平台启用和维护清理均未执行。代码与文档尚未提交。

## 2026-09-27 · 正式共享环境更正与适配阻断

用户明确正式环境为 `product-d2g59zty74d7d1ec1`，资源方 AppID 为 `wx7ad85943fe81e095`；本小程序仍为 `wxed8fdc5d559d973d`。抓取 origin/dev 后仍为落后 0、领先 1；保留原有未提交开发。

- 用本小程序 AppID 查函数返回 `ResourceNotFound.Namespace`。数据库 listCollections/listIndexes 虽报告 success，却没有列表明细，checkCollection 对三个集合返回 exists=true；后续资源方完整列表与这些返回不一致，不能将其作为资源存在的依据。
- 用用户提供的资源方 AppID 查环境，明确包含 product。完整函数列表为 9 项（含共用 cloudbase_auth），无 linggan_api/linggan_ai/linggan_maintenance；完整集合列表 Total=5，无本项目六集合。只读取元信息，未查其他应用的记录或密钥。
- 本地仍用默认 wx.cloud 和旧环境，账户派生仅处理 APPID/OPENID，缓存未按环境分区。部署前需要共享连接、来源身份拒绝策略、环境缓存隔离和云调用 AppID 适配。设计、规范及待实现覆盖行已补齐，不代表实现完成。
- 检查官方 wx-server-sdk 2.6.3 包的公开源码，确认 openapi 代理支持 appid 配置，getWXContext 从平台上下文键读取；包只下载到已忽略的 qa/local/sdk-inspection，未安装、升级或执行包脚本。官方源码入口：https://github.com/wechat-miniprogram/wx-server-sdk 。此核验不替代实际共享权限和审核调用验收。
- 共享适配补丁被自动安全审查拦截：既有部署授权未明确包含认证和数据边界改造。工具拦截前已写入部分客户端文件，随后只撤回本轮新增文件和相关改动；server/wx-identity 未写入，云函数未改动。已明确告知用户此部分写入与撤回事实，未绕过拦截重试。
- 撤回后 345/345 测试、202 项结构检查、7 项规范校验通过，云函数副本校验及 git diff --check 通过。三个云函数代码摘要与前一节一致。客户端原始字节摘要为 `42ff3f47c44377fb288c784a0c3b9b9a701cad29512805adfd9e51409b2f7b6e`（93 文件）；补丁往返改变了部分文件换行格式，发布前应以重新计算的摘要为准。

本轮最终只保留文档与规范的更新；共享适配仍待明确授权。没有云端写入、函数部署、客户端上传、AI 调用、实际清理、Git 提交、推送或 main 合并。
