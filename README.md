# 灵感拾光簿 · 原生微信小程序

一个面向个人用户的想法记录工具：随手记下内容、持续补充，再复制或整理成可使用的文字。照片和 AI 属于后续待接通能力，热度提炼已暂缓。

工程目录为 `D:\codex\coding\inspiration-miniprogram`，与 `yidian-miniprogram` 采用同一套工程约定（原生小程序 + 微信云开发 + OpenSpec 规范驱动开发）。

> **当前状态（2026-09-23）：记录、补充与文本输出代码已实现，但真机与云端未验收。**
> 领域层、服务层、六个页面、两个云函数、服务端协议层均有代码，263 项自动化测试通过。
> `docs/spec-coverage.md` 分别记录原 MVP 的 87 条场景和文本输出的 13 条场景。
>
> **云开关已打开**（环境 ID 已填），但这只表示客户端会去调云端——集合、云函数、
> 权限规则是否真的建好，要在云开发控制台里确认，代码看不出来。
> **AI 仍未启用**：模型厂商未定，见 `docs/PENDING-INPUT.md`。
>
> **尚不能认定产品可公开使用或提交审核。** 真机与开发者工具未做完整验证，
> `wx.*` 的绑定只有语法检查兜底；覆盖率表里还有「待验收」「部分覆盖」「待实现」三档。

## 获取与运行

需要 Node.js 20.19.0 或更新版本。

```bash
npm install          # 安装锁定版本的 @fission-ai/openspec
npm test             # 领域逻辑单元测试
npm run check        # 语法 / 配置 / 页面文件结构检查
```

微信开发者工具导入 `D:\codex\coding\inspiration-miniprogram`（**不要**选择其中的 `miniprogram` 子目录）。前端没有 npm 运行依赖，无需「构建 npm」。

`project.config.json` 已填写本项目 AppID，但这不表示云函数、集合和权限规则已完成部署；云端状态需在控制台核验。

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

首个变更 `add-inspiration-mvp` 规划记录、照片与 AI；当前可靠的客户端入口是记录与补充：

- **灵感记录与补充**：一句话快速记录，可修改原文并回看历史，也可追加补充。
- **拍照与 AI**：底层已有部分代码，页面尚未形成可用闭环，AI 开关保持关闭。
- **热度提炼**：已暂缓，不在当前交付范围。

独立变更 `add-content-output` 增加正文和补充复制、可编辑使用稿、另存为新灵感，以及带修改历史的文字留档和显式 TXT 文件发送。平台剪贴板、文件发送与页面渲染仍待真机验收。

详细的范围、非目标与验收标准见 [`openspec/changes/add-inspiration-mvp/proposal.md`](openspec/changes/add-inspiration-mvp/proposal.md)。

## 目录

| 目录 | 职责 |
| --- | --- |
| `miniprogram/core` | 领域模型、校验与 AI 结果的契约校验 |
| `miniprogram/services` | 会话、本机草稿、AI 调用与数据结构访问 |
| `miniprogram/pages` | 记录、灵感列表、详情、我的 |
| `miniprogram/config` | 云环境与 AI 开关（**云已打开**，AI 仍关闭） |
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
