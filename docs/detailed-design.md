# 详细设计

> 状态（2026-09-22）：本文档是 `add-inspiration-mvp` 变更的**实施级设计**，用于补足 `design.md`（概要设计）到代码之间的空白。
> 需求与验收标准以 `openspec/changes/add-inspiration-mvp/` 下的提案和四份规范为准；本文档只回答「接口长什么样、状态怎么变、什么时候报错」，不重复描述需求，也不代表任何功能已实现。
> **热度提炼已暂缓**（见 `proposal.md` 非目标），本文档不含热度实现细节，仅在 §10 保留占位说明。

## 0. 文档地图

防止跑偏的第一件事是**让每份文档只回答自己的问题**。有问题直接找对应那份，不要在四份文档之间来回翻。

| 你想知道 | 看哪份 | 它不回答什么 |
| --- | --- | --- |
| 这个产品要做什么、不做什么 | `openspec/changes/add-inspiration-mvp/proposal.md` | 怎么做 |
| 某个行为的确切规格（可验收） | `openspec/changes/add-inspiration-mvp/specs/*/spec.md` | 实现方式 |
| 为什么这么定、有哪些取舍 | `openspec/changes/add-inspiration-mvp/design.md`（概要设计） | 字段级细节 |
| 接口长什么样、状态怎么变、什么时候报错 | **本文档**（详细设计） | 需求本身 |
| 集合、字段、索引、权限规则、容量估算 | `docs/database-design.md` | 业务规则 |
| 界面区块、三种状态、文案与合规红线 | `docs/ui-design.md` | 代码结构 |
| 界面画出来是什么效果 | `docs/ui-mockup.html` | 真实渲染（那要开发者工具） |
| 规范里哪条实现了、哪条没有 | `docs/spec-coverage.md` | —— |
| 哪次改动验证了什么、没验证什么 | `docs/VERIFICATION.md` | —— |
| **怎么把云端接起来** | `docs/DEPLOYMENT.md` | 代码怎么改（那是本文档的事） |
| **卡在用户那边的凭据、决策、素材** | `docs/PENDING-INPUT.md` | —— |
| 还没立项的想法 | `docs/BACKLOG.md` | —— |

**三道自动闸门**，`npm test` 会跑。它们的存在都源于同一件事：**文档写完了，但没有任何东西保证后续开发会照着做。**

| 闸门 | 守住什么 | 已实测会红 |
| --- | --- | --- |
| `tests/spec-coverage.test.cjs` | 规范里新增或删除场景，而 `spec-coverage.md` 没跟着改；覆盖率表指向不存在的测试 | 是 |
| `tests/copy-rules.test.cjs` | 产品代码里出现禁用措辞（开发痕迹、本机/云端分层、旧标签、推销句式、热度暗示） | 是 |
| `tests/design-contract.test.cjs` | **本文档 §7.1 的函数清单、§7.3 的取值清单，以及 `database-design.md` 的字段清单，与代码实际不一致** | 是 |

第三道闸门是**字段级**的：调用真实的构造函数比对它产出的字段，而不是解析源码——重命名、增删字段都会立刻暴露。

**闸门管不到什么**（这一条要记牢）：

- **管不到实现对不对。** 它只能证明「文档里写的东西代码里有」，证明不了「代码做的和文档说的是一回事」。覆盖率表里那些「已覆盖」的条目，靠的是测试真的断言了场景，而不是闸门。
- **管不到界面。** 原型是 HTML，真实页面是 WXML，两者之间没有任何自动比对。页面实现时照不照原型做，仍然靠人。
- **管不到判断。** 一条场景该标「已覆盖」还是「部分覆盖」，是人的判断。标错了闸门不会拦。

换句话说：**闸门保证"没人能悄悄绕过"，不保证"做对了"。** 剩下的靠每次动手前回来看这份文档。

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

`requestId` 由客户端生成，同一逻辑操作重试时**复用同一个值**。服务端缓存 `(accountKey, requestId) → 响应`，重复请求直接返回缓存结果。这是**传输层幂等**，与 §8 的实体级幂等是两回事，两者都要有。

### 2.2 身份

身份**只能**从 `cloud.getWXContext()` 取。请求体中出现任何身份字段（`accountKey`、`openid`、`_openid`、`appid`、`unionid`）即整请求拒绝，返回 `IDENTITY_FIELD_REJECTED`，且**不写入任何数据**。

### 2.3 动作表

| action | payload | 成功返回 data | 说明 |
| --- | --- | --- | --- |
| `snapshot.pull` | `{}` | `{ generation, version, inspirations[], serverTime }` | 拉取账户全量快照 |
| `snapshot.push` | `{ baseVersion, generation, upserts[] }` | `{ version, applied[] }` | 增量写入。`upserts` 为新增或更新的整条灵感，服务端按 `id` upsert |
| `inspiration.delete` | `{ inspirationId }` | `{ deletedPhotos, version }` | 服务端单向原子完成，见 §2.4 |

原文可以直接改写，所以服务端**不再校验 `text` 不可变**（原 `IMMUTABLE_TEXT` 已撤销）。取而代之的是一条更本质的约束：

**服务端 MUST 校验 `textHistory` 只增不减。** 客户端可以改写 `text`，但不得从历史里删掉任何一版。违反返回 `HISTORY_TRUNCATED`。这是「你说过的话不会被悄悄抹掉」这条承诺在服务端的唯一落点——客户端自己不去删，不构成保证。

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
| `HISTORY_TRUNCATED` | 提交中删除了已有的原文历史版本 | 不重试，记为缺陷上报——这会破坏「说过的话不会被抹掉」的承诺 |
| `MERGE_TARGET_INVALID` | 汇总的指向关系不成立（目标不存在、指向自身、或形成环） | 不写入，提示汇总失败 |
| `NOT_FOUND` | 目标灵感不存在 | 刷新列表 |
| `CONFLICT` | `baseVersion` 与服务端 `version` 不一致 | 停止自动写入，保留本机意图，进入冲突态 |
| `STALE_GENERATION` | 客户端 `generation` 落后于服务端 | 丢弃离线队列，重新 pull |
| `LIMIT_EXCEEDED` | 超出条数 / 长度 / 大小上限 | 提示具体上限，不回滚已成功的部分 |
| `INTERNAL` | 未预期错误 | 保留输入，可重试 |

AI 相关错误码由 `linggan_ai` 返回，单独列在 §6，不复用上表。

## 3. 本机存储

> 本节是 2026-09-22 补写的。此前本文档只写了 `services/store.js` 负责「账户级快照、待同步队列、幂等键」，却**没说它存在哪里、用什么机制、容量怎么处理**。实施时无从下手，故补齐。

### 3.1 两条通道的分工

小程序提供两条互不相通的本地持久化通道，**都按 (小程序, 微信账户) 隔离**——这与本项目要做的账户数据隔离天然一致，**不需要在小程序侧再包一层隔离**。

| | 键值存储 | 文件系统 |
| --- | --- | --- |
| 接口 | `wx.setStorageSync` / `wx.getStorageSync`（另有异步版） | `wx.getFileSystemManager()` + `wx.env.USER_DATA_PATH` |
| 存什么 | 结构化数据，对象与数组直接塞 | 二进制文件 |
| 容量 | 10MB / (小程序, 账户) | 200MB / (小程序, 账户) |
| 本项目用途 | 灵感正文、补充、图片记录、待同步队列 | 照片原图与压缩件 |

约束：

- **不硬编码容量上限。** 运行时用 `wx.getStorageInfoSync()` 读 `limitSize` 与 `currentSize` 判断余量。平台数值可能调整，写死会在变更后失效。（上表的 10MB / 200MB 是撰写时的公开数值，未能当场复核官方文档，仅作量级参考。）
- **冷启动读取用同步版**（要立刻拿到数据才能渲染）；**数据量可能较大的写入用异步版**（同步版阻塞 JS 线程）。
- 键值存储里对象会被序列化，`Date` 会退化为字符串。**时间戳一律存数字**，不存 `Date`。

### 3.2 键值布局

沿用「一个账户一份文档」，与云端同构：

```
linggan:v1:snapshot     账户级快照
linggan:v1:queue        待同步队列
```

- `snapshot`：`{ generation, version, syncedAt, inspirations[] }`。字段结构与云端账户文档一致（见 §4），**推送时不需要格式转换**。
- `queue`：只存**尚未确认的待同步操作**，不是全量数据；确认成功后立即出队，避免它随数据量一起膨胀。
- key 带版本号（`v1`）。将来若必须改布局，靠版本号识别并做一次性迁移，而不是去猜旧格式。

**已知取舍：整份快照存在单个 key 里，每次写入都要全量序列化。** 规模小时（几百条以内、约几百 KB）是毫秒级，可以接受；数据量继续增长后这会成为写入瓶颈。

**切换分片的触发条件：快照超过 1MB 时**，改为「列表索引 + 单条明细」两层——列表页只读索引，写入单条只改一个小 key。届时迁移是「读全量 → 重新分片 → 写回」，可在一次启动内完成。

**为什么不一开始就分片**：MVP 规模下它引入的复杂度（索引与明细不同步、两份数据的一致性问题）高于收益。但**触发条件必须现在就写死在这里**，否则它会变成一个没人记得的隐患。

### 3.3 照片文件

```
wx.env.USER_DATA_PATH/linggan/{inspirationId}/{photoId}.jpg   压缩后待上传 / 已上传的本地缓存
wx.env.USER_DATA_PATH/linggan/tmp/                            压缩中间产物
```

清理规则：

- **上传失败的照片不得清理**——那是用户手上唯一的一份。
- 上传成功且云端确认后，本地文件**保留**，作为离线查看的缓存。
- 灵感删除**确认成功后**才删除对应目录；确认失败则全部保留，与 §2.4 一致。
- 容量不足时按 **LRU 清理已确认上传的本地照片缓存**（云端有原件，删本地不丢数据）。**未确认上传的一律不清理。**
- `tmp/` 在每次启动时清空——它只在一次压缩流程内有意义。

### 3.4 保存与同步是一个动作

> 2026-09-22 修订，取代此前「按云开关分两档判定」的写法（原 §11 第 6 项，已作废）。

**用户视角只有一次「保存」。** 它同时完成两件事：写入本机、同步到云端。界面**不出现「本机存储 / 云端存储」的区分**，也不出现「先存本机、稍后同步」这类分步描述——那是实现细节，不是用户需要理解的东西。

执行顺序：

1. **先落本机**，保证网络中断时也不丢用户刚写下的内容。
2. 立即尝试同步云端。
3. 云端确认 → 报告「已保存」。
4. 同步失败 → **当次就提示**，本机内容已保留，后台自动重试。

云未启用时（`cloud.enabled === false`）跳过第 2 步。用户看到的仍然是「已保存」——**这不是"降级"，而是同一个动作在没有云端时的自然结果**，界面不需要任何差别处理，也不需要提前预留别的状态位。

**失败时的措辞**：「已保存。还没同步到云端，会自动重试。」——数据确实已经在本机落定，谎报"没保存成功"会让用户重打一遍，那是更糟的错。但也不能只说「已保存」而不提同步没成。

### 3.5 写入失败与容量耗尽

- 本机写入抛异常（配额耗尽）时，**必须向用户明确报错，不得静默失败**。文案见 `ui-design.md`。文件系统同理。
- **文字与照片互相独立**：照片写不进去，不能让文字记录一起失败；反之亦然。

### 3.6 本机存储不是数据来源（工程说明，不是界面要求）

两条通道**都不是持久保证**：用户可以在微信里「删除小程序」或「清除缓存」一键清空，微信也可能在存储紧张时回收。

所以**本机永远只是缓存，云端才是数据来源**。本机写入存在的唯一理由是：让用户刚写下的内容在网络中断时也不丢，并让浏览不必等网络。

**这条不需要告诉用户。** 界面呈现的是「保存」这一个动作，不区分两层存储——用户不需要知道哪一份在哪。

## 4. 数据结构

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
  text: '……',                   // 当前原文。可直接改写（2026-09-22 修订）
  textHistory: [               // 历次被替换掉的版本，按时间倒序展示，只增不减
    { id: 'tex_…', text: '……', replacedAt: 1758500000000 }
  ],
  createdAt: 1758500000000,
  updatedAt: 1758500000000,
  supplements: [
    { id: 'sup_…', content: '……', createdAt: 1758500000000, source: 'user',
      contentHistory: [        // 这条补充自己的历史，与原文的 textHistory 同一套规则
        { id: 'chg_…', content: '……', replacedAt: 1758500000000 }
      ],
      mergedInto: null,        // 被 AI 汇总时指向汇总结果所在条目的 id
      foldedAt: null }         // 被合并进灵感的时刻（UI 标签「合并进灵感」）
    // source 取值：'user' | 'ai'，AI 产出必须标为 'ai'
  ],
  photos: [
    { id: 'pho_…', fileId: 'cloud://…', createdAt: 1758500000000 }
    // 只有上传成功（fileId 有效）的照片才写入此数组
  ],
  mergedInto: null,            // 本灵感被汇总进哪一条时写入
  deletedAt: null
}
```

`inspirations[]` 中**不出现**未上传成功的照片。上传中、上传失败属于本机临时状态（见 §5），不落云端——这样云端不需要表达「半张照片」，也就不存在半成品数据被同步到另一台设备的可能。

### 4.1 原文编辑的语义

- 改写 `text` 时，**被替换掉的旧版本先压入 `textHistory`，再写新的 `text`**。顺序不能反——先写新的、再补历史，中间失败就丢了一版。
- `textHistory` **只增不减**。服务端校验这一点（见 §2.3），客户端也不得提供任何删除历史的入口。
- 历史条目记 `replacedAt`（被替换的时刻），不记 `createdAt`——用户关心的是「这句话是什么时候被改掉的」。
- 改写**不影响**已有的补充：顺序、时间、内容全部保持。
- 改写**会**更新 `updatedAt`（列表按它排序），并同步运行状态机（§5.1）。
- 原文与补充沿用同一套长度上限与空值校验：清空不保存，超长拒绝且不截断。

### 4.2 汇总与「已合并」的语义

「覆盖」与「另存」的区别**只在于是否给来源打标记**，数据本身从不删除：

| | 汇总结果写入 | 被汇总的来源 |
| --- | --- | --- |
| **覆盖原来的** | 占据来源的位置 | 写入 `mergedInto` 指向结果，默认收起，可展开、可恢复 |
| **存一个新的** | 作为新增条目 | **完全不动**，仍独立可见 |

补充汇总与灵感汇总共用这一个模型：

- **补充汇总**：结果写成一条新的补充（`source: 'ai'`），被汇总的补充写 `mergedInto: <新补充的 id>`。
- **灵感汇总**：结果写回某一条灵感（**落点见 §11 第 7 项，尚未拍板**），其余被汇总的灵感写 `mergedInto: <目标灵感的 id>`。若结果覆盖了目标灵感的 `text`，旧原文照常压入它的 `textHistory`——两个机制在这里自然衔接，不需要额外规则。

约束：

- `mergedInto` **不得指向自身**，也**不得形成环**。服务端校验，违反返回 `MERGE_TARGET_INVALID`。
- 恢复一条已合并内容，只是把它的 `mergedInto` 清空，**不影响汇总结果本身**。两者并存。
- 已合并的内容**内容必须完整可读**——它只是默认收起，不是被截断或加密。任何读路径（查看、恢复、再次汇总）都必须能拿到全文。
- 已合并的灵感在列表中默认不出现，需要一个可发现的入口查看（`ui-design.md` 第 3 节）。**不能没有任何入口**——那等于变相删除。

本机 `snapshot` 的 `inspirations[]` 与上表同构，额外多出两类**只存在于本机**的信息：

- 每条灵感的**同步状态**（`synced / dirty / syncing / sync_failed / conflict`，见 §5.1）——同步状态由本机维护，**不落云端**。
- 每条灵感下**尚未上传成功的照片**（本机临时状态，见 §5.3）——不上传、不落云端。

### 4.3 单条补充的直接操作

长按一条补充弹出三个操作（2026-09-22 新增）。三者对数据的影响完全不同，处理也就不同：

| 操作 | 函数 | 对内容 | 可恢复性 |
| --- | --- | --- | --- |
| 修改 | `editSupplement` | 替换内容，旧内容进该条的 `contentHistory` | 历史可回看 |
| 合并进灵感 | `foldIntoText` | 内容追加进 `text`，本条写 `foldedAt` | `unfoldSupplement` 可恢复 |

> **术语对照（2026-09-22 改名）**：用户可见的标签是「合并进灵感」，代码里仍叫 `foldIntoText` / `foldedAt`——这个名字描述的是机制（把内容折进正文），比跟着文案改名更准确。**「合并」在本产品里有两个用法，指向不同目标**：这里的合并进的是**灵感原文**（`foldedAt`），AI 汇总的覆盖进的是**汇总结果**（`mergedInto`）。界面文案必须让目标可分辨，不能只写「合并」。
| 删除 | `removeSupplement` | **物理移除** | **不可恢复**，靠弹窗确认拦一道 |

**为什么「删除」是真删，而 §4.2 的 AI 汇总「覆盖」不真删？** 两者不是同一个情境：覆盖是 AI 的输出顶掉用户写的内容，用户并没有主动选择丢弃；删除是用户自己点下的动作，弹窗就是确认。**说删除却只是收起，是欺骗**——用户会以为内容已经没了。这两条放在一起看不矛盾。

四处容易踩空的地方：

**删掉汇总结果会留下悬空引用。** 若 sup_a、sup_b 被汇总进 sup_sum，直接删掉 sup_sum，那两条的 `mergedInto` 就指向了一个不存在的目标——它们会永远收在时间线里出不来，用户既看不到也不知道为什么。所以 `removeSupplement` 必须**顺带把指向它的补充恢复**（清空那些 `mergedInto`）。有用例专门断言不留下悬空引用。

**合并进灵感可能撑破正文上限。** 补充上限 1000、正文上限 2000，一条接近上限的补充并进一条已经接近上限的正文就会越界。长度校验因此放在 `foldIntoText` 里，**超了整条拒绝、不做截断**，也不留下半合并状态。

**已合并／已并入灵感的补充不允许直接修改。** 它们已经不在时间线上正常显示，先恢复再改，用户才看得清自己在改什么。违反返回 `ALREADY_MERGED` / `ALREADY_FOLDED`。

**恢复已并入灵感的补充不回退原文。** `unfoldSupplement` 只清 `foldedAt`，让这一条重新出现在时间线上；合并进去的内容照常留在原文里。回退原文是另一回事（从 `textHistory` 取回），塞进这里会让用户以为「恢复」等于撤销。

## 5. 状态机

### 5.1 同步状态（本机维护，不落云端）

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

**这套状态机几乎全部是本机内部状态，界面只呈现其中两个结果**：

- `dirty` 与 `syncing` 只存在于一次保存动作的执行期内（先落本机、随即同步），**转瞬即逝，界面不呈现**。
- `synced` 对应界面上的「已保存」。
- `sync_failed` 与 `conflict` 才需要让用户看见——前者给出「还没同步到云端，会自动重试」，后者给出明确的处理入口。
- 云未启用时所有条目恒为 `synced`，`dirty` 与 `queue` 都不会出现。

**界面不得把 `dirty` / `syncing` 渲染成「待同步」之类的常驻标记**——那会把内部状态摊给用户，正是本节要避免的两层存储感。

### 5.2 灵感生命周期

`active → deleting → deleted`

| 从 | 到 | 触发 |
| --- | --- | --- |
| `active` | `deleting` | 用户确认删除 |
| `deleting` | `deleted` | 云端返回 `ok: true`，此时才清理本机记录与本地图片文件 |
| `deleting` | `active` | 云端确认失败，**全部保留**，提示用户 |

处于 `deleting` 的灵感在列表和详情中必须可见并标明状态，不能提前消失——否则用户会以为已删，而服务端其实什么都没做。

云未启用时没有「云端确认」这一步，删除在本机即时完成——同样是因为没有远端可确认，与 §3.4 是同一处取舍。

### 5.3 照片

`selected → compressed → uploading → uploaded | upload_failed`

分支：`compressed → rejected`（压缩后仍超 2 MB 上限）

| 从 | 到 | 触发 |
| --- | --- | --- |
| `selected` | `compressed` | 压缩完成 |
| `compressed` | `rejected` | 压缩后仍超出 `photoMaxBytes`，提示上限后丢弃该张，**其余图片不受影响** |
| `compressed` | `uploading` | 进入上传 |
| `uploading` | `uploaded` | 上传成功，才写入 `inspiration.photos[]` |
| `uploading` | `upload_failed` | 失败。本地文件**保留**（见 §3.3），状态单独展示 |
| `upload_failed` | `uploading` | 用户重试。**沿用同一 `photoId`**，覆盖同一存储对象 |

权限被拒不是照片状态，而是页面级分支：不读取任何图片，给出开启指引，且完全不影响该灵感的文字记录与补充。

### 5.4 AI 草案（纯本机，不持久化）

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

草案**只存在于页面内存中**，不写本机存储——键值存储同样不写。离开页面或重启小程序即丢弃，重新进入时不得出现半成品数据。这是规范「确认前离开」场景的直接落点。

### 5.5 汇总草案（纯本机，不持久化）

`idle → selecting → generating → ready → confirmed | discarded`

| 从 | 到 | 触发 |
| --- | --- | --- |
| `idle` | `selecting` | 用户进入选择态 |
| `selecting` | `generating` | 选中数量达到下限并请求汇总 |
| `generating` | `ready` | 返回且通过契约校验与内容安全过滤 |
| `generating` | `failed` / `disabled` / `quota_exceeded` | 对应错误码 |
| `ready` | `confirmed` | 用户选定「覆盖」或「另存」并确认 |
| `ready` | `discarded` | 用户放弃 |

约束：

- 选中数量不足下限时**不进入 `generating`**——补充少于 2 条、灵感少于 2 个都不发请求，也不消耗额度。汇总一条内容没有意义。
- `ready` 态下用户必须**显式选择**「覆盖」还是「另存」，**没有默认值**。这是整条链路上不可逆程度最高的一步，不能替用户预选。
- 与 §5.4 相同，草案只存在于页面内存，离开即丢弃。
- **失败不留痕**：任何失败路径都不得写入空的汇总结果或半合并状态；被选中的内容与汇总前完全一致。

## 6. AI 契约与降级

### 6.1 请求与返回

同一个云函数 `linggan_ai` 承载两个动作，共用一套额度与降级逻辑：

```js
// 扩展
{ action: 'expand', text, supplements: [string] }
→ { ok: true, data: { points: [], nextSteps: [], risks: [] } }

// 汇总
{ action: 'summarize', scope: 'supplements' | 'inspirations', items: [{ id, content }] }
→ { ok: true, data: { text: '……' } }
```

`scope` 决定 `items` 的含义：

- `'supplements'`——同一灵感下被选中的补充，`content` 就是补充内容。
- `'inspirations'`——被勾选的灵感，`content` 是该灵感的**原文与其全部补充拼接**后的文本。汇总需要看到完整的一条，只看原文会丢掉后来才想清楚的部分。

**请求体必须设总长度上限**：`items` 的条数与拼接后的总字符数都要卡住，超限直接拒绝、不调用模型、不消耗额度。否则勾选几十条长灵感时会打出一次超大请求，成本与超时都不可控。（具体上限见 §11 第 8 项。）

### 6.2 契约约束

`core/ai-contract.js` 的 `validateDraft` 必须逐项检查：

- `points`、`nextSteps`、`risks` 三个字段均**必需**，且均为字符串数组；
- 各数组长度 1—5 项；
- 每项长度 ≤ 200 字符，且非空白；
- 任一不满足 → `AI_CONTRACT_INVALID`，**不展示、不写入**，按生成失败处理并允许重试。

### 6.3 越界内容规则

命中即返回 `AI_UNSAFE_CONTENT`，不展示、不写入。需要覆盖：医疗与用药建议、极端行为、外部链接、以及其他超出本产品范围的内容。

规则以实现期可单测的正则 + 白名单落地，**规则集本身需在实施前单独评审**——纯正则易误伤（例如把「这个 App 的链接逻辑」判为外链），评审时需一并确定误伤的处理方式。

### 6.4 降级路径

两个动作共用同一套降级，差异只在提示措辞：

| 场景 | 扩展 | 汇总 | 基础功能 |
| --- | --- | --- | --- |
| `ai.js` 的 `enabled` 为 `false` | 说明该能力还没开放 | 同左，且**不出现汇总入口** | 完全可用 |
| 超时 | 本次扩展失败，可重试 | 本次汇总失败，可重试 | 完全可用 |
| 额度耗尽 | 说明额度限制 | 同左 | 完全可用 |
| 契约校验失败 | 本次生成失败，可重试 | 本次汇总失败，可重试 | 完全可用 |
| 内容安全命中 | 说明被拒绝的原因 | 同左 | 完全可用 |
| 选中数量不足 | —— | 说明至少需要两条（补充）或两个（灵感），**不发起调用、不消耗额度** | 完全可用 |

未启用时**不得**展示任何看似 AI 生成的结果，也不得以「AI 扩展」名义展示本地规则拼接的结果。

**任何失败路径都不得改变被选中的内容。** 失败之后，被选中的补充或灵感必须与汇总前一模一样——不出现空的汇总结果，不出现半合并状态。

## 7. 模块签名（core 与 services）

### 7.1 `core/inspiration.js`

```js
// 写入
createInspiration({ text, id, now })                  → Inspiration   // 校验失败抛 ValidationError
updateText(inspiration, { text, historyId, now })     → Inspiration   // 改写原文，旧版本压入历史
appendSupplement(inspiration, { content, id, source, now }) → Inspiration
editSupplement(inspiration, { supplementId, content, historyId, now }) → Inspiration
foldIntoText(inspiration, { supplementId, historyId, now }) → Inspiration   // 界面标签「合并进灵感」
unfoldSupplement(inspiration, { supplementId })        → Inspiration
removeSupplement(inspiration, { supplementId })        → Inspiration   // 真删，并恢复指向它的补充
markSupplementMerged(inspiration, { supplementId, targetId, now }) → Inspiration
unmergeSupplement(inspiration, { supplementId })       → Inspiration
mergeSupplements(inspiration, { summary, sourceIds, mode, now }) → Inspiration
appendPhoto(inspiration, { id, fileId, now })         → Inspiration
markMerged(inspiration, { targetId, now })            → Inspiration   // 标记本灵感已合并进 targetId
unmerge(inspiration)                                  → Inspiration   // 清空 mergedInto，恢复为独立灵感
markDeleted(inspiration, { now })                     → Inspiration
validateInspiration(input)                            → { ok, errors: [{ field, code }] }

// 查询与判定
isDeleted(inspiration)         → boolean
isMerged(inspiration)          → boolean
isSupplementHidden(supplement) → boolean         // 被 AI 汇总合并、或已合并进灵感
activeSupplements(inspiration) → Supplement[]    // 时间线上默认展示的那些
mergedSupplements(inspiration) → Supplement[]    // 因 AI 汇总而收起的
foldedSupplements(inspiration) → Supplement[]    // 因合并进灵感而收起的
byUpdatedAtDesc(a, b)          → number          // 列表排序：按 updatedAt 倒序
```

**这张清单与代码是绑定的**：`tests/design-contract.test.cjs` 会比对 `module.exports` 里的每个函数，少一个多一个都红。加函数、改函数名，必须同步这一段。

约束：

- 全部为**纯函数**，返回新对象，不修改入参。
- **`updateText` 是改写的唯一路径，且签名强制要求同时提供 `historyId`。** 这是刻意的：让「改写但不留历史」在调用层面根本写不出来，而不是靠实现者记得。写新 `text` 与压旧版本在同一次返回里完成，不存在中间态。
- **不导出任何删除历史的函数。** `textHistory` 只增不减，服务端也会校验（§2.3）。
- 深冻结保留——它防的是误改内存中的对象，不是阻止合法改写。改写一律走「返回新对象」。
- `now` 一律由调用方注入，内部**不得**调用 `Date.now()`，否则 `npm test` 无法稳定断言。
- 同时提供抛错版（`createInspiration`）与不抛错版（`validateInspiration`），页面用后者做即时校验，服务端与测试用前者做硬校验。

### 7.2 `core/ai-contract.js`

```js
validateDraft(raw)    → { ok: true, value: Draft } | { ok: false, code, field }
validateSummary(raw)  → { ok: true, value: Summary } | { ok: false, code, field }
checkSafety(text)     → { ok: boolean, rule?: string }
```

汇总结果的契约（`Summary` 为 `{ text: string }`）：

- `text` 必须是非空字符串，长度不超过 `LIMITS.summaryMaxLength`（**新值待定，见 §11 第 10 项**）。
- 同样过 `checkSafety`。
- 空结果、超长、结构不合法、命中安全规则 → 一律拒绝，**不展示、不写入**，按汇总失败处理。
- 汇总**不产出结构化三分区**（那是 `ai-expansion` 的形态），只产出一段连续文本——汇总的本质是把多条收成一条，不是重新分析。

### 7.3 `core/errors.js` 与 `core/limits.js`

**实际落地与本文档初稿的偏差**：初稿把错误码常量表放在 `core/limits.js`。实施时拆出了独立的 `core/errors.js`——错误码与 `ValidationError` 被 `inspiration.js`、`ai-contract.js` 以及后续的 `services/`、`server/` 共用，塞进「取值边界」模块里内聚性太差。本节按实际结构记录。

`core/errors.js`（新增）：

```js
ERROR_CODES      校验错误码常量表（EMPTY_TEXT / TEXT_TOO_LONG / INVALID_ID / UNSAFE_CONTENT …）
ERROR_MESSAGES   错误码到中文文案的映射，文案面向用户，不含开发者黑话
ValidationError  errors: [{ field, code }]，code 取首项，页面可逐字段定位
```

错误码的值是稳定字符串，会出现在测试断言与降级判断里，改名即破坏兼容。

`core/limits.js`——**这里是全部取值的一处清单**，代码里的每一个键都必须在这张表里，反之亦然。`tests/design-contract.test.cjs` 会核对，两边不一致直接红。

| 键 | 值 | 来源 | 用途 |
| --- | --- | --- | --- |
| `textMaxLength` | 2000 | 骨架 | 正文长度上限 |
| `supplementMaxLength` | 1000 | 骨架 | 单条补充长度上限 |
| `photoMaxBytes` | 2097152 | 骨架 | 单张照片压缩后大小上限（2MB） |
| `photosPerInspiration` | 9 | 骨架 | 每条灵感的照片数上限 |
| `heatMin` | 0 | 骨架 | 热度下限。热度已暂缓，取值保留 |
| `heatMax` | 100 | 骨架 | 热度上限。同上 |
| `idMaxLength` | 64 | 本变更 | 标识长度上限。标识参与云存储路径拼接，必须有明确字符集与长度约束 |
| `aiMinTextLength` | 8 | 本变更 | 正文短于此长度不请求 AI 扩展，避免空洞草案且不消耗额度 |
| `draftSectionMinItems` | 1 | 本变更 | AI 草案每个分区的最少条目数 |
| `draftSectionMaxItems` | 5 | 本变更 | AI 草案每个分区的最多条目数 |
| `draftItemMaxLength` | 200 | 本变更 | AI 草案单条目的长度上限 |
| `mergeMinItems` | 2 | 本变更 | 汇总所需的最少来源条数（补充）或个数（灵感） |
| `summaryMaxLength` | 2000 | 本变更 | 汇总结果的长度上限 |
| `summaryMaxSourceItems` | 20 | 本变更 | 单次汇总可携带的来源条数上限 |
| `summaryMaxSourceChars` | 12000 | 本变更 | 来源内容拼接后的总字符数上限，防止打出超大请求 |

**最后四项没有明确依据**，是实施时取的保守默认，**需要评审后定稿**（见 §11 第 10 项）。

**未设定的项**：`supplementMaxCount` 不设上限——规范只约束单条补充的长度，未要求条数上限；凭空加一个限制会让用户在长线灵感上撞到无谓的墙。若后续确有需要再单独提案。

### 7.4 `core/heat.js`

**本变更不实现**，见 §10。

### 7.5 `services/store.js`

本机状态与持久化。**存储与网络都从外面注入，不直接依赖 wx**——这是让降级路径可测的唯一办法：

- 离线、配额耗尽、同步失败，在真机上很难稳定复现，而它们占了规范里一半的场景。
- 注入之后，这三条路径都能在 Node 里直接断言。

```js
// 模块级导出
createStore({ storage, transport, now }) → Store
emptySnapshot()                          → Snapshot   // 初始快照，读不出东西时也退回它
```

`Store` 实例上的方法：

```js
// 快照
readSnapshot()                 → Snapshot          // 读不出来时退回初始快照，不让应用起不来
writeSnapshot(snapshot)        → Snapshot          // 存储写失败时**抛出**
// 待同步队列
readQueue()                    → Op[]
enqueue({ id, kind, payload }) → { queue, requestId, enqueuedAt }   // 按 id 幂等
dequeue(opId)                  → Op[]
clearQueue()                   → Op[]
// 保存与删除
saveInspiration(inspiration)   → Promise<SaveResult>
deleteInspiration(id)          → Promise<SaveResult>   // 先软删，同步确认后才物理移除
// 读取
listInspirations()             → Inspiration[]     // 排除已删除与已合并，按 updatedAt 倒序
getInspiration(id)             → Inspiration | null
```

`enqueue` 除了队列还返回 `requestId`——**它在入队时定下来并随队列一起持久化**，重试同一条队列项时复用同一个值，服务端的传输层幂等才成立。将来的重试循环必须用它，不能每次重新生成。

`transport.send(action, payload, meta)` 的第三个参数是 `{ requestId }`，与上面是同一个值。

`deleteInspiration` 的顺序是**先软删 → 再确认 → 最后物理移除**（§5.2）：云端确认失败时本机数据不动，用户不会遇到「本机删了、云端还在」。云未启用时没有确认这一步，直接完成。

**注入的接口**：

| 参数 | 需要实现 | 约定 |
| --- | --- | --- |
| `storage` | `get(key)` / `set(key, value)` / `remove(key)` | `set` 在配额耗尽时**抛出**，不静默失败 |
| `transport` | `send(action, payload) → Promise<{ ok, data?, code? }>` | 为 `null` 表示云未启用，保存跳过同步 |
| `now` | `() → number` | 毫秒时间戳。**必须是函数**，内部不调用 `Date.now()` |

**`SaveResult` 的三种形态，与界面上的三种呈现一一对应**（`ui-design.md` 第 2 节）：

| 形态 | 界面 |
| --- | --- |
| `{ ok: true, synced: true }` | 「已保存」 |
| `{ ok: true, synced: false, code }` | 「已保存。还没同步到云端，会自动重试。」 |
| `{ ok: false, code: 'LOCAL_WRITE_FAILED' }` | 「存储空间不够了，这条没能存下来。」+ **保留输入** |

**保存的执行顺序是刻意的**：先落本机 → 再入队 → 最后发起同步。**入队必须早于同步**，否则同步途中崩溃，这条意图就丢了——用户以为已经保存，而云端和队列里都没有它。

**本机写入失败时不去调用云端**：下游没有任何东西可同步，调用只会浪费一次请求并让错误信息变模糊。

### 7.6 `services/capture-drafts.js`

未提交补充的会话内草稿。对应 `specs/inspiration-capture/spec.md` 的「未提交的补充不因切页丢失」。

```js
// 模块级导出
createCaptureDrafts() → Drafts
```

```js
// Drafts 实例上的方法
get(inspirationId)            → string      // 没写过返回空串，可直接绑到输入框
set(inspirationId, text)      → string      // 写入空串等同清除；纯空白不算空
clear(inspirationId)          → void        // 提交成功后调用
clearAll()                    → void
has(inspirationId)            → boolean
```

**这个模块刻意不接触任何存储**——全部状态就是一个闭包里的 `Map`，进程结束即消失。

规范写明「未提交的内容不是数据，只是草稿」。一旦给它加上持久化，草稿就悄悄变成了「内容」：用户会以为没提交的东西也存着，而删除灵感、清理缓存这些动作都不会碰它，最后留下一堆谁也说不清的残留。`tests/capture-drafts.test.cjs` 里有一条用例直接扫源码，确认它没碰存储。

生命周期由调用方决定：`app.js` 启动时建一个放进 `globalData`，各页面共用**同一个实例**——这就是「同一会话内共用一个草稿区」的全部实现。

### 7.7 `services/wx-storage.js`

把 wx 的同步存储包装成 `store` 需要的接口。**唯一需要注意的是配额异常原样上抛**，不吞、不转成静默失败。

```js
// 模块级导出
createWxStorage() → Storage
```

```js
// Storage 实例上的方法
get(key)          → value | ''      // 绑定 wx.getStorageSync
set(key, value)   → void            // 配额耗尽时**抛出**，原样交给调用方
remove(key)       → void
info()            → { keys, currentSize, limitSize }   // 绑定 wx.getStorageInfoSync
```

`set` 抛异常这件事是**契约的一部分**：`store` 靠它区分「本机写入失败」与「同步未成功」——两者在界面上的行为完全相反（一个要保留用户输入，一个要清空），吞掉异常会把它们混成一团。

`info()` 存在的理由是**不把容量上限写死在代码里**：平台数值会变，`limitSize` 才是权威值。调用方用 `currentSize / limitSize` 判断余量，而不是拿一个常数去比。

### 7.8 `core/format.js`

展示格式化。纯函数，零 wx 依赖。列表、详情、原文历史三处都要用，所以放 `core/`——散在页面里迟早会出现三套阈值。

```js
// 模块级导出
formatRelative(ts, now)  → string   // 刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前 / YYYY-MM-DD
formatAbsolute(ts)       → string   // YYYY-MM-DD HH:mm
summarize(text, max)     → string   // 取首行，超长截断加省略号
countLabel(count, unit)  → string   // 为 0 时返回空串
```

**按经过时间分桶，不做日历日运算。** 日历日要用本地时区算当天零点，结果依赖运行环境的时区，测试没法稳定断言；经过时间桶对同一组 `(ts, now)` 永远给同一个结果。代价是「昨天」按 24—48 小时计，与严格日历日可能差几小时——这个精度对「上次什么时候动的」足够了。

阈值本身是**产品决定**，所以 `tests/format.test.cjs` 把每个边界都断言了：改阈值就会红，逼着人回头确认设计。

`formatAbsolute` 与 `formatRelative` 超过 30 天后的那一段都用本地时区，**跨时区运行可能差几小时**，这是刻意的取舍。

`countLabel` 对 0 返回空串：界面上「0 条补充」是噪音，不该出现。

### 7.9 `core/merge.js`

灵感级的汇总编排。单独一个模块，因为 `core/inspiration.js` 里的函数都是**对单条对象**的纯函数，而「把多个灵感汇总成一个」同时改动目标、来源和（另存时）一条全新的灵感。

```js
// 模块级导出
mergeInspirations(inspirations, input) → Inspiration[]
```

与 `mergeSupplements` 一样是**一次调用的原子操作**：返回完整的新数组，失败抛 `ValidationError`。规范要求「失败不留痕」，分步做的话中间任何一步出错都可能留下半合并状态。

覆盖与另存的差别**只在「汇总结果落在哪」和「来源是否收起」**，数据从不删除：

| mode | 汇总结果 | 被汇总的来源 |
| --- | --- | --- |
| `overwrite` | 成为目标的 `text`（旧原文经 `updateText` 进历史） | 写 `mergedInto`，默认收起 |
| `append` | 成为一条全新灵感 | 写 `mergedInto`，默认收起 |

`targetId` 必须是 `sourceIds` 之一——否则「覆盖」会去改一条用户根本没勾选的灵感，返回 `MERGE_SELF`。

### 7.10 `services/photo.js`

照片的本地环节：权限、选图、压缩、上限校验。**上传不在这里**（见 7.11）。

```js
// 模块级导出
createPhotoService({ ensurePermission, chooseMedia, compressImage }) → PhotoService
```

```js
// PhotoService 实例上的方法
prepare({ source, existingCount }) → Promise<PrepareResult>
```

两条刻意的行为：

- **数量已到顶时在读图之前就拦住。** 先读再拒等于白白让用户授权了一次。
- **压缩后仍超限的图片被拒绝，不做二次压缩。** 反复压到能过会让画质掉到用户认不出自己拍的是什么，那比拒绝更糟。

无论成败都返回 `limit`（`{ maxBytes, maxCount }`）——界面要能说出「上限是多少」，不能只说「超了」。

### 7.11 `services/upload.js`

照片上传与云存储清理。

```js
// 模块级导出
createUploader({ uploadFile, removeFile }) → Uploader
photoCloudPath(accountKey, inspirationId, photoId) → string
```

```js
// Uploader 实例上的方法
uploadPhoto({ accountKey, inspirationId, photoId, tempFilePath }) → Promise<UploadResult>
removePhotos(fileIds) → Promise<{ ok, removed, failed }>
```

**幂等靠对象名，不靠去重逻辑。** 对象名固定为 `linggan/{accountKey}/{inspirationId}/{photoId}`，重传覆盖同一对象——这就是规范「同一次上传被重复提交，云端只保留一个对象」的实现方式，不需要「先查再传」。

**路径拼接的每一段都重新校验字符集**（`SAFE_SEGMENT`），**故意不再 import `core/inspiration.js` 的 `ID_PATTERN`**：这条校验守的是跨系统边界，不该因为上游哪天放宽了字符集就跟着放宽。

`removePhotos` 返回**逐个文件**的结果而不是一个总成败：部分成功是真实存在的情况，压成一个布尔值会让调用方无法决定「哪些记录可以安全地删掉」。

### 7.12 `services/ai.js`

AI 调用与降级。**只负责「调用 → 校验 → 返回结果对象」，不负责把结果写进数据**——「确认后才落盘」由页面做。

```js
// 模块级导出
createAiService({ enabled, callModel, quota, timeoutMs }) → AiService
```

```js
// AiService 实例上的方法
expand({ text, supplements })                     → Promise<Result>
summarize({ scope, items })                       → Promise<Result>
```

一次生成的顺序是刻意的：未启用 → **扣额度** → 调用 → 超时 → 契约校验。

- **额度在调用之前扣**：否则超额的那次已经把模型调出去了，成本已经产生。
- **校验不过则退还**：那是平台侧的锅，不该记在用户头上。
- **过短（扩展）与过少（汇总）在扣额度之前就返回**：规范要求这两种情况**不消耗额度**。

四条降级路径（未启用、超时、额度耗尽、校验失败）各有独立的错误码与**可直接展示的中文说明**——失败只给一个码，界面就没法如实告诉用户发生了什么。

### 7.13 `server/repository.js`

服务端的仓库层：账户文档的读写、幂等、冲突与代际。放在 `server/` 而不是 `cloudfunctions/` 里，是为了能脱离云环境单测。

```js
// 模块级导出
createRepository({ db, removeFiles, now }) → Repository
emptyAccount(accountKey, now)              → Account        // 初始账户文档
```

```js
// Repository 实例上的方法
pull(accountKey)                        → Promise<Result>
push(accountKey, payload)               → Promise<Result>
remove(accountKey, payload)             → Promise<Result>
```

`db` 需要实现 `get(accountKey)` / `put(accountKey, doc)`，**都是异步的**——微信云数据库就是异步的，早期写成同步接口是个不匹配，已改。

`push` 的三道校验缺一不可：

1. **代际**：客户端 `generation` 落后 → `STALE_GENERATION`，让它丢弃离线队列。这保证已清理的数据不会被离线旧设备回传。
2. **版本**：`baseVersion` 不一致 → `CONFLICT`，不自动合并、不覆盖。
3. **历史只增不减**：客户端可以改 `text`，但不得从 `textHistory` 里删掉任何一版 → `HISTORY_TRUNCATED`。**这是「你说过的话不会被悄悄抹掉」在服务端唯一的落点**——客户端自己不去删，不构成保证。

`remove` 是先软删 → 删云存储 → 物理移除，第 2 步失败即回滚。这样「图片已删但灵感还在」的中间状态在服务端就不可能产生。

### 7.14 `server/protocol.js`

云函数协议层：动作分发、身份、传输层幂等。

```js
// 模块级导出
createProtocol({ repository, requestCache, cacheTtlMs, now }) → Protocol
```

```js
// Protocol 实例上的方法
handle(context, event) → Promise<Result>
```

身份**从参数传进来，不在这里读 wx 上下文**——这一层要能在 Node 里单测，取上下文是云函数入口的事。

**传输层幂等**（`requestId`）与**实体级幂等**（按 `id` upsert，在 7.13）是两回事，两者都要有：前者防的是「请求重复到达」，后者防的是「同一份数据被提交多次」。

未预期的异常一律收敛成 `INTERNAL` 并返回固定的中文说明，**不透出堆栈**。

### 7.15 `services/wx-transport.js`

`wx.cloud.callFunction` 的适配器——store 的 `transport` 的真实实现。

```js
// 模块级导出
createWxTransport({ functionName, callFunction, newRequestId }) → Transport
createRequestId()                                              → string
```

```js
// Transport 实例上的方法
send(action, payload, meta) → Promise<Result>
```

**只做三件事：拼信封、发出去、把结果原样带回。** 不重试、不降级、不解释错误码——那些是 store 和页面的事。

这一层越薄越好：它跨在 wx 边界上，是**最不可能被测到的一层**（Node 里跑不了真实调用），所以逻辑越少，出错的面越小。`callFunction` 仍然做成可注入的，好把「云函数返回了畸形结果」这条路径也测到。

云函数抛错时 result 里带的是 `errMsg` 而不是我们的信封。这种**不属于业务失败**，收敛成 `INTERNAL` 交给 store 处理——它会保留内容并稍后重试，同时不把内部错误原文透给调用方。

## 8. 幂等与冲突

- **实体幂等**：`(accountKey, id)`。服务端对 `upserts` 按 `id` upsert，重复提交只产生一次效果。
- **传输幂等**：`(accountKey, requestId)`，TTL 内重复请求返回缓存响应。
- **图片幂等**：存储对象名固定为 `linggan/{accountKey}/{inspirationId}/{photoId}`，重传覆盖同一对象而非新增，因此重试不会产生重复文件。本机文件路径（§3.3）同样以 `photoId` 结尾，重试覆盖同一文件。
- **冲突**：`baseVersion` 与服务端 `version` 不等即返回 `CONFLICT`。客户端不自动重试、不自动合并、不覆盖，保留本机意图并进入 `conflict` 态等待用户处理。
- **代际**：客户端在每次 push 时携带自己记录的 `generation`。服务端代际更高时返回 `STALE_GENERATION`，客户端丢弃离线队列——这保证已清理的数据不会被离线旧设备回传。

## 9. 降级路径总表

| 失效项 | 必须仍然可用 | 提示位置 |
| --- | --- | --- |
| 云端不可达 | 记录、补充、浏览（内容已落本机） | 页面内联「已保存。还没同步到云端，会自动重试。」 |
| 本机存储写满 | 已保存的内容与浏览 | 页面内联，说明存储空间不足 |
| 照片上传失败 | 正文、补充、已上传成功的图片 | 照片区单独标记，可重试 |
| 相机 / 相册权限被拒 | 该灵感的文字记录与补充 | 页面内联 + 开启指引 |
| AI 未启用 / 超时 / 超额度 / 校验失败 | 全部基础能力 | AI 区说明，不阻塞页面 |

「页面内联」是刻意的选择：`wx.showToast` 会自动消失，用户容易错过失败提示，从而误以为已保存成功。凡是**用户会据此误判数据状态**的提示，一律用页面内联，不用 toast。

## 10. 热度提炼：本变更暂缓

热度提炼（`inspiration-heat` 规范）**不在本变更范围内**，留待后续独立变更实施。原因：热度依赖补充条数、照片数量、AI 扩展次数等信号，这些在 MVP 完成前都是零，此时实现热度既无法验证也无法调优；等基础能力落地、用户手上有了真实数据之后再做，权重才有依据。

本变更内不做的事：

- 不实现 `core/heat.js`。
- 灵感数据结构中**保留** `heat` 字段名但不写入，避免后续变更做数据迁移。
- 列表与详情页**不出现**任何热度分数或理由的展示位。
- 界面文案不得提及热度，也不得用其他名称暗示存在排序评分。

`openspec/changes/add-inspiration-mvp/specs/inspiration-heat/spec.md` 的内容**原样保留**、不删除，待后续提案时迁移过去；在本变更归档前不得把它当作已实现能力。

## 11. 实施前仍需拍板的决策

| # | 决策 | 状态 |
| --- | --- | --- |
| 1 | 补充条数是否设上限（`supplementMaxCount`） | **已定**：不设上限，理由见 §7.3 |
| 2 | 越界内容规则集的具体条目与误伤处理 | **已落地基线，仍需评审**。`SAFETY_RULES` 已实现覆盖外链 / 医疗用药 / 极端行为三类，规则刻意保守并已有「不误伤普通词」的测试；具体条目与误伤处置方式仍待你确认 |
| 3 | AI 走云开发内置能力，还是自建调第三方 | **未定**，阻塞 `linggan_ai` 与环境变量设计，不阻塞 `core/` |
| 4 | `requestId` 缓存的服务端 TTL | **未定**，阻塞 `server/`，不阻塞 `core/` |
| 5 | 本机存储布局：单键快照，超 1MB 触发分片 | **已定**，理由与触发条件见 §3.2 |
| 6 | 保存与同步是否合并为一个动作 | **已定（2026-09-22 你的决定）**：保存后自动同步云端，失败则提示；界面不区分本机与云端。见 §3.4 |
| 7 | 原文改为可编辑，并保留历史版本 | **已定（2026-09-22 你的决定）**：取代原「原文不可改写」这条 Requirement。见 §4.1 |
| 8 | 「覆盖」时被汇总的内容只标记不删除 | **已定（2026-09-22 你的决定）**：见 §4.2 |
| 9 | 灵感汇总「覆盖」时，汇总结果写回哪一条 | **未定**。候选：写回最早创建的一条 / 让用户在界面上选。落点不影响数据安全（被合并的都只标记不删除），但影响用户预期 |
| 10 | 汇总的长度上限（`items` 条数、拼接总字符数、`summaryMaxLength`） | **未定**，阻塞 `linggan_ai` 与契约校验的实现 |

第 6 项按你的决定改定了。原来写的「按云开关分两档判定」已作废，界面上的「待同步」常驻标记与「数据只在这台手机上」告警也一并去掉。

**但这处决定与 `inspiration-capture` 规范的措辞有出入，需要处理。** 规范写的是「系统 SHALL 在云端确认后才向用户报告保存成功」「不得呈现为已保存」，而新方案在同步失败时会说「已保存。还没同步到云端，会自动重试」。

我的判断是新措辞更诚实——数据确实已经在本机落定，谎报「没保存成功」会让用户重打一遍，那是更糟的错。但**规范原文与实现不一致这件事必须解决**，否则本变更归档时对不上。改规范属于提案范畴，我不擅自改；你说了我再动。
