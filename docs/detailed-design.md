# 详细设计

> 状态（2026-09-22）：本文档是 `add-inspiration-mvp` 变更的**实施级设计**，用于补足 `design.md`（概要设计）到代码之间的空白。
> 需求与验收标准以 `openspec/changes/add-inspiration-mvp/` 下的提案和四份规范为准；本文档只回答「接口长什么样、状态怎么变、什么时候报错」，不重复描述需求，也不代表任何功能已实现。
> **热度提炼已暂缓**（见 `proposal.md` 非目标），本文档不含热度实现细节，仅在 §9 保留占位说明。

## 1. 分层与依赖方向

```
pages/      渲染与事件转发。不写业务判断，不直接调 wx.cloud
   ↓
services/   有状态、包 wx API。网络访问一律经注入的 transport，便于注入失败
   ↓
core/       纯函数，零 wx 依赖。npm test 直接覆盖
```

硬性约束：

- `core/` 不得 require `services/` 或任何页面模块，不得引用 `wx.*`。
- `services/` 之间不得循环依赖。
- `pages/` 只调 `services/` 与 `core/limits`，不自己判断业务规则。
- 云函数侧 `cloudfunctions/linggan_api/index.js` 只做两件事：从可信上下文取身份、转发给 `server/`。业务逻辑全部在 `server/`，以便脱离云环境单测。
- `server/` 是构建产物的唯一来源。`scripts/build-cloud.cjs` 负责把它同步进 `cloudfunctions/`，`npm run check` 断言产物与源码一致——不同步即视为失败。

## 2. 云函数协议

### 2.1 信封

```js
// 客户端请求
wx.cloud.callFunction({
  name: 'linggan_api',
  data: { action, payload, requestId }
});

// 成功
{ ok: true, data: { /* 见动作表 */ } }

// 失败
{ ok: false, code: 'CONFLICT', message: '可直接展示给用户的中文说明' }
```

`requestId` 由客户端生成，同一逻辑操作重试时**复用同一个值**。服务端缓存 `(accountKey, requestId) → 响应`，重复请求直接返回缓存结果。这是**传输层幂等**，与 §7 的实体级幂等是两回事，两者都要有。

### 2.2 身份

身份**只能**从 `cloud.getWXContext()` 取。请求体中出现任何身份字段（`accountKey`、`openid`、`_openid`、`appid`、`unionid`）即整请求拒绝，返回 `IDENTITY_FIELD_REJECTED`，且**不写入任何数据**。

### 2.3 动作表

| action | payload | 成功返回 data | 说明 |
| --- | --- | --- | --- |
| `snapshot.pull` | `{}` | `{ generation, version, inspirations[], serverTime }` | 拉取账户全量快照 |
| `snapshot.push` | `{ baseVersion, generation, upserts[] }` | `{ version, applied[] }` | 增量写入。`upserts` 为新增或更新的整条灵感，服务端按 `id` upsert |
| `inspiration.delete` | `{ inspirationId }` | `{ deletedPhotos, version }` | 服务端单向原子完成，见 §2.4 |

`upserts` 只增不改：任何试图改写已有灵感 `text` 的提交返回 `IMMUTABLE_TEXT`。服务端必须做这项校验，不能只依赖客户端不去做。

### 2.4 删除的执行顺序

删除必须是「全成功或全保留」，不允许出现图片已删但灵感还在的中间状态。服务端按序执行：

1. 写入 `deletedAt`（软删）。
2. 删除该灵感在云存储下的全部对象。
3. 物理移除该条灵感记录。

第 2 步失败即回滚 `deletedAt` 并返回失败，客户端**不得**移除本地数据。只有收到 `ok: true` 才清理本机记录。这与 `photo-capture` 规范中「删除确认失败则灵感与照片全部保留」一一对应。

### 2.5 错误码总表

| code | 触发条件 | 客户端处置 |
| --- | --- | --- |
| `UNAUTHENTICATED` | 可信上下文缺失或 openid 为空 | 提示稍后重试；不重试写入 |
| `FORBIDDEN_SOURCE` | 请求来自未获准的小程序 | 同上 |
| `IDENTITY_FIELD_REJECTED` | 请求体含身份字段 | 不重试，记为缺陷上报 |
| `INVALID_ACTION` | 未知 action | 不重试 |
| `INVALID_PAYLOAD` | 参数校验失败 | 不重试，提示内容不合规 |
| `IMMUTABLE_TEXT` | 试图改写已有灵感的原始正文 | 不重试，引导用户改为新增补充 |
| `NOT_FOUND` | 目标灵感不存在 | 刷新列表 |
| `CONFLICT` | `baseVersion` 与服务端 `version` 不一致 | 停止自动写入，保留本机意图，进入冲突态 |
| `STALE_GENERATION` | 客户端 `generation` 落后于服务端 | 丢弃离线队列，重新 pull |
| `LIMIT_EXCEEDED` | 超出条数 / 长度 / 大小上限 | 提示具体上限，不回滚已成功的部分 |
| `INTERNAL` | 未预期错误 | 保留输入，可重试 |

AI 相关错误码由 `linggan_ai` 返回，单独列在 §5，不复用上表。

## 3. 数据结构

账户文档（集合 `linggan_accounts`，一账户一份）：

| 字段 | 写入方 | 说明 |
| --- | --- | --- |
| `accountKey` | 服务端 | 由可信上下文推导，不接受客户端传入 |
| `generation` | 服务端 | 数据代际。仅在用户主动清空或代际变更时递增；正常删除单条灵感**不**递增 |
| `version` | 服务端 | 账户级版本号，每次成功写入递增，用于冲突判定 |
| `updatedAt` | 服务端 | 服务端时间戳 |
| `inspirations[]` | 客户端提交、服务端校验 | 灵感数组 |

单条灵感：

```js
{
  id: 'insp_lz9k_4f2a',        // 客户端生成，服务端校验格式，作幂等键
  text: '……',                   // 原始正文，写入后不可变
  createdAt: 1758500000000,
  updatedAt: 1758500000000,
  supplements: [
    { id: 'sup_…', content: '……', createdAt: 1758500000000, source: 'user' }
    // source 取值：'user' | 'ai'，AI 产出必须标为 'ai'
  ],
  photos: [
    { id: 'pho_…', fileId: 'cloud://…', createdAt: 1758500000000 }
    // 只有上传成功（fileId 有效）的照片才写入此数组
  ],
  deletedAt: null
}
```

`inspirations[]` 中**不出现**未上传成功的照片。上传中、上传失败属于本机临时状态（见 §4），不落云端——这样云端不需要表达「半张照片」，也就不存在半成品数据被同步到另一台设备的可能。

## 4. 状态机

### 4.1 同步状态（本机维护，不落云端）

`synced → dirty → syncing → synced`

迁移与触发：

| 从 | 到 | 触发 |
| --- | --- | --- |
| `synced` | `dirty` | 本机产生任意变更 |
| `dirty` | `syncing` | 进入推送 |
| `syncing` | `synced` | 收到 `ok: true` |
| `syncing` | `sync_failed` | 网络失败或 `INTERNAL` |
| `syncing` | `conflict` | 收到 `CONFLICT` |
| `sync_failed` | `syncing` | 用户重试，或网络恢复后自动重试 |
| `conflict` | `syncing` | 用户**显式选择**以本机为准，基于最新 `version` 重新提交 |
| 任意 | `synced` | 收到 `STALE_GENERATION`，丢弃离线队列后重新 pull |

关键约束：`conflict` 态**不得自动重试、不得自动合并**。规范要求「由用户在页面明确处理」——UI 上必须给出可见的冲突提示和明确的处理入口，不能静默重试。

### 4.2 灵感生命周期

`active → deleting → deleted`

| 从 | 到 | 触发 |
| --- | --- | --- |
| `active` | `deleting` | 用户确认删除 |
| `deleting` | `deleted` | 云端返回 `ok: true`，此时才清理本机记录与本地图片缓存 |
| `deleting` | `active` | 云端确认失败，**全部保留**，提示用户 |

处于 `deleting` 的灵感在列表和详情中必须可见并标明状态，不能提前消失——否则用户会以为已删，而服务端其实什么都没做。

### 4.3 照片

`selected → compressed → uploading → uploaded | upload_failed`

分支：`compressed → rejected`（压缩后仍超 2 MB 上限）

| 从 | 到 | 触发 |
| --- | --- | --- |
| `selected` | `compressed` | 压缩完成 |
| `compressed` | `rejected` | 压缩后仍超出 `photoMaxBytes`，提示上限后丢弃该张，**其余图片不受影响** |
| `compressed` | `uploading` | 进入上传 |
| `uploading` | `uploaded` | 上传成功，才写入 `inspiration.photos[]` |
| `uploading` | `upload_failed` | 失败。本地文件**保留**，状态单独展示 |
| `upload_failed` | `uploading` | 用户重试。**沿用同一 `photoId`**，覆盖同一存储对象 |

权限被拒不是照片状态，而是页面级分支：不读取任何图片，给出开启指引，且完全不影响该灵感的文字记录与补充。

### 4.4 AI 草案（纯本机，不持久化）

`idle → generating → ready → adopted | partially_adopted | discarded`

失败分支：`generating → failed | disabled | quota_exceeded`

| 从 | 到 | 触发 |
| --- | --- | --- |
| `idle` | `generating` | 用户请求扩展 |
| `generating` | `ready` | 返回且通过契约校验与内容安全过滤 |
| `generating` | `failed` / `disabled` / `quota_exceeded` | 对应错误码 |
| `ready` | `adopted` | 全部采纳，写成若干条 `source: 'ai'` 的补充 |
| `ready` | `partially_adopted` | 逐条采纳，**只写被采纳项** |
| `ready` / `partially_adopted` | `discarded` | 用户放弃，不写任何数据，不留空条目 |

草案**只存在于页面内存中**，不写本机存储。离开页面或重启小程序即丢弃，重新进入时不得出现半成品数据。这是规范「确认前离开」场景的直接落点。

## 5. AI 契约与降级

### 5.1 请求与返回

```js
// 请求 linggan_ai
{ action: 'expand', text, supplements: [string] }

// 成功
{ ok: true, data: { points: [], nextSteps: [], risks: [] } }
```

### 5.2 契约约束

`core/ai-contract.js` 的 `validateDraft` 必须逐项检查：

- `points`、`nextSteps`、`risks` 三个字段均**必需**，且均为字符串数组；
- 各数组长度 1—5 项；
- 每项长度 ≤ 200 字符，且非空白；
- 任一不满足 → `AI_CONTRACT_INVALID`，**不展示、不写入**，按生成失败处理并允许重试。

### 5.3 越界内容规则

命中即返回 `AI_UNSAFE_CONTENT`，不展示、不写入。需要覆盖：医疗与用药建议、极端行为、外部链接、以及其他超出本产品范围的内容。

规则以实现期可单测的正则 + 白名单落地，**规则集本身需在实施前单独评审**——纯正则易误伤（例如把「这个 App 的链接逻辑」判为外链），评审时需一并确定误伤的处理方式。

### 5.4 降级路径

| 场景 | 提示 | 基础功能 |
| --- | --- | --- |
| `ai.js` 的 `enabled` 为 `false` | 说明该能力尚未开放 | 完全可用 |
| 超时 | 本次扩展失败，可重试 | 完全可用 |
| 额度耗尽 | 说明额度限制 | 完全可用 |
| 契约校验失败 | 本次生成失败，可重试 | 完全可用 |
| 内容安全命中 | 说明被拒绝的原因 | 完全可用 |

未启用时**不得**展示任何看似 AI 生成的结果，也不得以「AI 扩展」名义展示本地规则拼接的结果。

## 6. 领域层模块签名

### 6.1 `core/inspiration.js`

```js
createInspiration({ text, id, now })                  → Inspiration   // 校验失败抛 ValidationError
appendSupplement(inspiration, { content, id, source, now }) → Inspiration
appendPhoto(inspiration, { id, fileId, now })         → Inspiration
markDeleted(inspiration, { now })                     → Inspiration
validateInspiration(input)                            → { ok, errors: [{ field, code }] }
```

约束：

- 全部为**纯函数**，返回新对象，不修改入参。
- **不导出任何改写 `text` 的函数**。这是规范的硬约束，也是 `IMMUTABLE_TEXT` 在客户端侧的对应保障。
- `now` 一律由调用方注入，内部**不得**调用 `Date.now()`，否则 `npm test` 无法稳定断言。
- 同时提供抛错版（`createInspiration`）与不抛错版（`validateInspiration`），页面用后者做即时校验，服务端与测试用前者做硬校验。

### 6.2 `core/ai-contract.js`

```js
validateDraft(raw)  → { ok: true, value: Draft } | { ok: false, code, field }
checkSafety(text)   → { ok: boolean, rule?: string }
```

### 6.3 `core/errors.js` 与 `core/limits.js`

**实际落地与本文档初稿的偏差**：初稿把错误码常量表放在 `core/limits.js`。实施时拆出了独立的 `core/errors.js`——错误码与 `ValidationError` 被 `inspiration.js`、`ai-contract.js` 以及后续的 `services/`、`server/` 共用，塞进「取值边界」模块里内聚性太差。本节按实际结构记录。

`core/errors.js`（新增）：

```js
ERROR_CODES      校验错误码常量表（EMPTY_TEXT / TEXT_TOO_LONG / INVALID_ID / UNSAFE_CONTENT …）
ERROR_MESSAGES   错误码到中文文案的映射，文案面向用户，不含开发者黑话
ValidationError  errors: [{ field, code }]，code 取首项，页面可逐字段定位
```

错误码的值是稳定字符串，会出现在测试断言与降级判断里，改名即破坏兼容。

`core/limits.js`（扩展，已有取值未改动）：

| 新增键 | 值 | 用途 |
| --- | --- | --- |
| `idMaxLength` | 64 | 标识长度上限。标识参与云存储路径拼接，必须有明确字符集与长度约束 |
| `aiMinTextLength` | 8 | 正文短于此长度不请求 AI 扩展，避免空洞草案且不消耗额度 |
| `draftSectionMinItems` | 1 | AI 草案每个分区的最少条目数 |
| `draftSectionMaxItems` | 5 | 每个分区的最多条目数 |
| `draftItemMaxLength` | 200 | 单条目的长度上限 |

**未设定的项**：`supplementMaxCount` 不设上限——规范只约束单条补充的长度，未要求条数上限；凭空加一个限制会让用户在长线灵感上撞到无谓的墙。若后续确有需要再单独提案。

### 6.4 `core/heat.js`

**本变更不实现**，见 §9。

## 7. 幂等与冲突

- **实体幂等**：`(accountKey, id)`。服务端对 `upserts` 按 `id` upsert，重复提交只产生一次效果。
- **传输幂等**：`(accountKey, requestId)`，TTL 内重复请求返回缓存响应。
- **图片幂等**：存储对象名固定为 `linggan/{accountKey}/{inspirationId}/{photoId}`，重传覆盖同一对象而非新增，因此重试不会产生重复文件。
- **冲突**：`baseVersion` 与服务端 `version` 不等即返回 `CONFLICT`。客户端不自动重试、不自动合并、不覆盖，保留本机意图并进入 `conflict` 态等待用户处理。
- **代际**：客户端在每次 push 时携带自己记录的 `generation`。服务端代际更高时返回 `STALE_GENERATION`，客户端丢弃离线队列——这保证已清理的数据不会被离线旧设备回传。

## 8. 降级路径总表

| 失效项 | 必须仍然可用 | 提示位置 |
| --- | --- | --- |
| 云端不可达 | 记录、补充、浏览本机快照 | 页面内联「尚未保存成功」 |
| 相机 / 相册权限被拒 | 该灵感的文字记录与补充 | 页面内联 + 开启指引 |
| 图片上传失败 | 正文、补充、已上传成功的图片 | 照片区单独标记，可重试 |
| AI 未启用 / 超时 / 超额度 / 校验失败 | 全部基础能力 | AI 区说明，不阻塞页面 |

「页面内联」是刻意的选择：`wx.showToast` 会自动消失，用户容易错过失败提示，从而误以为已保存成功。凡是**用户会据此误判数据状态**的提示，一律用页面内联，不用 toast。

## 9. 热度提炼：本变更暂缓

热度提炼（`inspiration-heat` 规范）**不在本变更范围内**，留待后续独立变更实施。原因：热度依赖补充条数、照片数量、AI 扩展次数等信号，这些在 MVP 完成前都是零，此时实现热度既无法验证也无法调优；等基础能力落地、用户手上有了真实数据之后再做，权重才有依据。

本变更内不做的事：

- 不实现 `core/heat.js`。
- 灵感数据结构中**保留** `heat` 字段名但不写入，避免后续变更做数据迁移。
- 列表与详情页**不出现**任何热度分数或理由的展示位。
- 界面文案不得提及热度，也不得用其他名称暗示存在排序评分。

`openspec/changes/add-inspiration-mvp/specs/inspiration-heat/spec.md` 的内容**原样保留**、不删除，待后续提案时迁移过去；在本变更归档前不得把它当作已实现能力。

## 10. 实施前仍需拍板的决策

| # | 决策 | 状态 |
| --- | --- | --- |
| 1 | 补充条数是否设上限（`supplementMaxCount`） | **已定**：不设上限，理由见 §6.3 |
| 2 | 越界内容规则集的具体条目与误伤处理 | **已落地基线，仍需评审**。`SAFETY_RULES` 已实现覆盖外链 / 医疗用药 / 极端行为三类，规则刻意保守并已有「不误伤普通词」的测试；具体条目与误伤处置方式仍待你确认 |
| 3 | AI 走云开发内置能力，还是自建调第三方 | **未定**，阻塞 `linggan_ai` 与环境变量设计，不阻塞 `core/` |
| 4 | `requestId` 缓存的服务端 TTL | **未定**，阻塞 `server/`，不阻塞 `core/` |
