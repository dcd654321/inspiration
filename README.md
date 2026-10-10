# 灵感拾光簿 · 原生微信小程序

一个面向个人用户的想法记录工具：随手记下内容、持续补充，手动选材、编辑成稿，再复制、导出或主动分享。当前版本已移除生成式 AI 集成；照片、分享和核心保存的实际可用性按云端与真机证据验收。

工程目录为 `D:\codex\coding\inspiration-miniprogram`，与 `jiancheng-miniprogram` 采用同一套工程约定（原生小程序 + 微信云开发 + OpenSpec 规范驱动开发）。

> **当前状态（2026-10-08）：记录与手动整理版本，移除 AI 集成；本地修改尚未提交。**
> 客户端保留 14 个页面，构建与默认部署仅含两个云函数（`linggan_api` / `linggan_maintenance`）。
> 本次不操作已部署的 AI 函数、额度集合或远端配置；自动化验证结果以 `docs/VERIFICATION.md` 最新条目为准。
> `docs/spec-coverage.md` 按能力分别记录每条规范场景落在哪一档。
>
> **环境按版本解析（2026-09-29 起）**：开发版/体验版连共享测试环境 `cloud1-d8gopnalv908bb47a`，
> 正式版连共享正式环境 `product-d2g59zty74d7d1ec1`（资源方 `wx7ad85943fe81e095`）。
> 历史回读曾确认六个 `linggan_` 集合已在正式环境创建；当前部署输入收口为五个集合、十四个业务索引。函数部署走 `npm run deploy:cloud -- --env test|product`
> （部署前强制核对云函数目录与源码一致）。共享初始化已在正式环境通过；测试环境的函数、集合与函数环境变量
> 需按 `deployment/product/manifest.json` 同一清单部署后才能用于日常开发。
> **AI 工作台、入口、开关与模型调用服务已移除**；历史生成来源仍如实标识，当前没有 AI 启用待办。
>
> **移除集成不代表重新审核通过。** 用户提交的上一版被微信按个人主体深度合成类目驳回；修改版仍需开发者工具、真机与重新审核，
> `wx.*` 的绑定只有语法检查兜底；覆盖率表里还有「待验收」「部分覆盖」两档。

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

## 功能与当前进度

当前变更与历史提案在 `openspec/changes/` 下；`remove-ai-integration` 覆盖 AI 开放与启用要求，逐场景状态见 `docs/spec-coverage.md`。

| 能力 | 本地代码 | 当前可用性 |
| --- | --- | --- |
| 灵感记录、补充、改写与历史 | 已完成 | 本地回归；当前环境可靠保存与真机待验收 |
| 搜索、筛选、阶段与每日回顾 | 已完成 | 本地回归；真实账户与真机待验收 |
| 复制、使用稿模板、TXT 留档 | 已完成 | 真实剪贴板与文件发送待真机验收 |
| 跨灵感手动选材整理 | 已完成 | 不依赖 AI；真实云保存待验收 |
| 照片拍摄、上传、私有预览、分步删除 | 已完成 | **未开放**：服务端 `LINGGAN_PHOTOS_ENABLED` 为 `false`，入口不显示 |
| AI 扩展、汇总与工作台 | 已撤下 | 发布包及默认构建部署不再包含生成能力 |
| 分享文字与朋友圈海报、意见反馈 | 已完成 | **未开放**：密钥、审核与索引未在平台配置 |
| 热度提炼 | 未实现 | 已暂缓，不在当前交付范围 |

「已完成」指本地代码与自动化测试到位，**不等于云端可用或已验收**。

## 目录

| 目录 | 职责 |
| --- | --- |
| `miniprogram/core` | 领域模型、记录校验、手动整理及历史来源兼容（纯函数，零 `wx` 依赖） |
| `miniprogram/services` | 云确认保存、会话内草稿、照片编排、分享与协议适配 |
| `miniprogram/pages` | 14 个页面：3 个 tab 页与 11 个二级页（含启动过渡页），清单见 `docs/ui-design.md` |
| `miniprogram/config` | 云环境与资源名（客户端云开关已打开） |
| `cloudfunctions/` | 两个云函数入口；`server/`、`core/` 是 `scripts/build-cloud.cjs` 同步进去的副本 |
| `server/` | 服务端业务逻辑的唯一来源，可脱离云环境单测 |
| `deployment/product/` | 目标环境的集合、索引与函数清单（部署输入，不含已部署状态） |
| `scripts` | 结构检查、云函数同步与 OpenSpec 运行包装 |
| `tests` | 领域逻辑与协议单元测试；不等于真机 E2E |
| `docs` | 设计、验证记录与回滚说明 |

## 上线前仍必须完成

- 在 product 环境核验十四个业务索引、五个当前集合的「所有用户不可读写」规则及两个函数版本与配置。历史索引回读成功不替代当前验收。
- 生成并配置 `LINGGAN_SHARE_TOKEN_KEY`、`LINGGAN_MAINTENANCE_TOKEN`，核对审核与小程序码云调用权限。
- 两个微信账户、两台设备的数据隔离与跨设备一致性验证。
- iOS/Android 真机、窄屏、大字号、相册权限与拍照失败场景验证。
- 开启照片前完成存储规则与私有读取、上传、删除的独立验收。
- 按实际记录、手动整理、照片和分享功能更新提审简介与截图，重新提交审核。
- 小程序名称、类目、备案与隐私说明（含照片用途）在微信公众平台单独确认。
