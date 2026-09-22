# 灵感记录 · 原生微信小程序

一个面向个人用户的灵感捕捉工具：随手记下想法，之后可以补充、拍照附图，由 AI 帮忙扩展成更完整的思路，并提炼这条灵感值不值得继续投入的热度信号。

工程目录为 `D:\codex\coding\inspiration-miniprogram`，与 `yidian-miniprogram` 采用同一套工程约定（原生小程序 + 微信云开发 + OpenSpec 规范驱动开发）。

> **当前状态（2026-09-22）：仅完成工程初始化骨架。**
> 四个核心功能（灵感记录与补充、拍照上传、AI 扩展、热度提炼）已在 OpenSpec 中立项为 `add-inspiration-mvp` 变更提案，**尚未实现**。云环境、云函数、AI 能力均未接入，`miniprogram/config/cloud.js` 与 `miniprogram/config/ai.js` 默认关闭。这不是一个可用产品，也不能提交审核。

## 获取与运行

需要 Node.js 20.19.0 或更新版本。

```bash
npm install          # 安装锁定版本的 @fission-ai/openspec
npm test             # 领域逻辑单元测试
npm run check        # 语法 / 配置 / 页面文件结构检查
```

微信开发者工具导入 `D:\codex\coding\inspiration-miniprogram`（**不要**选择其中的 `miniprogram` 子目录）。前端没有 npm 运行依赖，无需「构建 npm」。

`project.config.json` 中的 `appid` 目前是 `touristappid`（游客模式），仅够打开骨架预览。接入云开发前必须替换为本项目自己的 AppID——云开发要求真实 AppID，游客模式不支持。

## OpenSpec 工作流

```bash
npm run openspec -- list                              # 查看进行中的变更
npm run openspec -- validate add-inspiration-mvp --strict   # 校验单个提案
npm run openspec -- validate --all --strict           # 校验全部
npm run openspec -- archive add-inspiration-mvp       # 用户验收后才归档
```

目录职责：

| 目录 | 说明 |
| --- | --- |
| `openspec/specs/` | 已落地的能力规范（当前为空，尚无已实现能力） |
| `openspec/changes/` | 进行中的变更提案 |
| `openspec/changes/archive/` | 已验收归档的变更 |
| `openspec/config.yaml` | schema、项目上下文与各产物规则 |

## 功能规划

首个变更 `add-inspiration-mvp` 覆盖四项能力：

- **灵感记录与补充**：一句话快速落记录，之后可多次追加补充，保留时间线，不覆盖原文。
- **拍照上传**：为灵感附照片，多图、压缩、上传失败可重试，删除灵感时同步清理。
- **AI 扩展灵感**：把零散的一句话扩展成结构化的想法草案，用户确认后才写入。
- **灵感热度提炼**：从内容与互动信号中提炼热度评分和理由，辅助判断优先级。

详细的范围、非目标与验收标准见 [`openspec/changes/add-inspiration-mvp/proposal.md`](openspec/changes/add-inspiration-mvp/proposal.md)。

## 目录

| 目录 | 职责 |
| --- | --- |
| `miniprogram/core` | 领域模型、校验与 AI 结果的契约校验 |
| `miniprogram/services` | 会话、本机草稿、AI 调用与数据结构访问 |
| `miniprogram/pages` | 记录、灵感列表、详情、我的 |
| `miniprogram/config` | 云环境与 AI 开关（默认关闭） |
| `cloudfunctions/linggan_api` | 本小程序专属云函数入口（未部署） |
| `scripts` | 结构检查与 OpenSpec 运行包装 |
| `tests` | 领域逻辑单元测试；不等于真机 E2E |
| `docs` | 设计、验证记录与回滚说明 |

## 上线前仍必须完成

- 实现并验收四项核心能力，补齐数据模型与云端读写。
- 接入云开发环境、替换真实 AppID、配置云函数与数据库集合权限。
- 完成 AI 额度、限流、内容安全、输出校验与失败降级后才可开启 `ai.js` 的 `enabled`。
- 两个微信账户、两台设备的数据隔离与跨设备一致性验证。
- iOS/Android 真机、窄屏、大字号、相册权限与拍照失败场景验证。
- 小程序名称、类目、备案与隐私说明（含照片用途）在微信公众平台单独确认。
