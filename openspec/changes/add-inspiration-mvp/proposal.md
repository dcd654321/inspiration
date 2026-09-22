# Proposal

## Why

灵感往往在一瞬间出现，又在一瞬间消失。用户现在只能靠备忘录或聊天窗口随手记，记完之后既没有地方继续补充，也无法把一句话变成可判断的东西。本变更要把「记下来 → 补充 → 拍照留证 → AI 帮我展开」串成一个闭环，让灵感从一句话变成能继续推进的想法。

（原本设想的第五环「哪条更值得做」由热度提炼承担，已于 2026-09-22 决定暂缓，见 What Changes 末条。）

工程已于 2026-09-22 完成初始化骨架（OpenSpec 目录、构建与检查脚本、可导入开发者工具的最小页面），业务代码尚未编写。本提案描述拟新增的行为，不代表任何功能已经实现或验收。

## What Changes

- **灵感记录与补充**：一句话即可落记录；之后可多次追加补充，形成只追加的时间线，原始记录不被覆盖或改写。
- **拍照上传**：为灵感附加照片，支持拍照与相册多选，压缩后上传；上传失败可重试且不产生重复文件；删除灵感时同步清理云端文件。
- **AI 扩展灵感**：把灵感原文与选定补充交给 AI，生成结构化想法草案（要点、可执行的下一步、可能的风险）；**必须由用户确认后**才写入，AI 输出先通过结构校验与内容安全校验。
- 新增本项目专属云端资源：云函数 `linggan_api`（业务读写）、`linggan_ai`（AI 能力，默认不启用）、集合 `linggan_accounts`、云存储前缀 `linggan/`。
- **非目标**：不做社交、评论、关注与分享；不做多人协作或团队空间；不接入支付与会员；不抓取或展示外部热榜/搜索指数；不做全文检索与标签体系；不自动迁移任何历史备忘录数据；不修改其他小程序的函数、集合与共用认证配置。
- **本变更暂缓（2026-09-22 决定）**：**灵感热度提炼不做**，留待后续独立变更。原因是热度依赖补充条数、照片数量、AI 扩展次数等信号，这些在 MVP 完成前均为零，此时实现既无法验证也无法调优。本变更内不实现 `core/heat.js`，列表与详情页不出现热度展示位，界面文案不得提及热度或以「优先级评分」等名称暗示存在评分功能；灵感数据结构中保留 `heat` 字段名但不写入，避免后续变更做数据迁移。`specs/inspiration-heat/spec.md` 的内容原样保留、不删除，待后续提案时迁移，**在本变更归档前不得当作已实现能力**。

## Capabilities

### New Capabilities

- `inspiration-capture`：灵感的一次记录与多次补充，保持原记录的不可变性。
- `photo-capture`：灵感的照片采集、压缩、上传、重试与随灵感删除的清理。
- `ai-expansion`：把零散灵感扩展为结构化草案，且只在用户确认后落盘。

本变更**不含** `inspiration-heat`。该能力的规范文件 `specs/inspiration-heat/spec.md` 为暂缓期间的原样保留，不属于本变更的交付范围，也不得随本变更归档。归档前需先把它移出本变更目录。

### Modified Capabilities

无。当前 `openspec/specs/` 为空，本变更只新增能力，不重新声明任何既有实现。

## Impact

- 拟新增：`miniprogram/pages/capture`、`miniprogram/pages/detail`、`miniprogram/pages/list` 的业务实现；`miniprogram/core/inspiration.js`（领域模型与校验）、`miniprogram/core/ai-contract.js`（AI 输出契约）；`miniprogram/services/` 下的会话、草稿、上传与 AI 调用；`cloudfunctions/linggan_api`、`cloudfunctions/linggan_ai`；`server/` 下的协议与仓库层；对应测试。
- **本变更不新增** `miniprogram/core/heat.js`（已暂缓）。
- 拟新增文档：`docs/detailed-design.md`（接口契约、状态机、错误码）、`docs/ui-design.md`（页面区块与三态呈现）。
- 拟修改：`miniprogram/app.json`（页面注册）、`miniprogram/config/cloud.js`（环境与开关，保持 `enabled: false` 直到用户授权）、`miniprogram/config/cloud-resources.js`。
- 远端范围仅限本项目 `linggan_*` 资源。**本提案不授予任何远端变更权限**：创建集合、部署云函数、启用 AI、配置环境变量均需在实施阶段单独取得授权。
- 本地现状已核验：工程只有骨架，`config/cloud.js` 与 `config/ai.js` 的 `enabled` 均为 `false`，无任何业务页面逻辑与测试。
- 验收成功标准：用户能完成「记录 → 补充 → 拍照 → AI 扩展」全流程；两个微信账户互不可见；AI 不可用时前三项基础能力完全可用；删除灵感后云端照片被清理。**提案完成不等于上述标准已经达成。**
