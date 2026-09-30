# 详细设计

> 状态（2026-09-28）：§1—11 为 MVP 基础设计；§12—17 记录后续实现及覆盖旧约定的升级。§17 的云确认方案覆盖 §2、§3、§5、§13 中的设备持久快照、离线队列和照片暂存约定。
> 当前小程序包含 15 个页面、19 个 service 文件、3 个云函数与 12 个服务端 action；旧设备持久化、离线队列和照片落盘实现已移到包外的 `qa/legacy/`，仅供历史规范测试。自动化测试的最新通过数以 `docs/VERIFICATION.md` 为准。
> 本文档描述**接口、状态及错误**；凡某节写的是当时的目标方案而实现已改，该节会显式标注「由 §X 覆盖」，未标注的不代表已实现。
> 各能力的平台启用、云端部署与真机验收**均未完成**，本地代码完成不等于能力可用。
> **热度提炼已暂缓**（见 `proposal.md` 非目标），本文档不含热度实现细节，仅在 §10 保留占位说明。

## 0. 文档地图

防止跑偏的第一件事是**让每份文档只回答自己的问题**。有问题直接找对应那份，不要在四份文档之间来回翻。

| 你想知道 | 看哪份 | 它不回答什么 |
| --- | --- | --- |
| 这个产品要做什么、不做什么 | `openspec/changes/add-inspiration-mvp/proposal.md` | 怎么做 |
| 某个行为的确切规格（可验收） | `openspec/changes/<变更>/specs/*/spec.md` | 实现方式 |
| 为什么这么定、有哪些取舍 | `openspec/changes/add-inspiration-mvp/design.md`（概要设计） | 字段级细节 |
| 接口长什么样、状态怎么变、什么时候报错 | **本文档**（详细设计） | 需求本身 |
| 页面清单、区块、三种状态、文案与合规红线 | `docs/ui-design.md` | 代码结构 |
| 界面画出来是什么效果 | `docs/ui-mockup.html`、`docs/evidence-development-*/` | 真实渲染与真机（那要开发者工具与真机） |
| 集合、字段、索引、权限规则、容量估算 | `docs/database-design.md` | 业务规则 |
| 规范里哪条实现了、哪条没有 | `docs/spec-coverage.md` | —— |
| 哪次改动验证了什么、没验证什么 | `docs/VERIFICATION.md` | —— |
| **怎么把云端接起来** | `docs/DEPLOYMENT.md`、`deployment/product/` | 代码怎么改（那是本文档的事） |
| product 部署范围与发布验收 | `openspec/changes/deploy-product-release/` | AI 计费启用、真实清理或 Git 合并授权 |
| 分享与反馈的目标、场景 | `openspec/changes/add-sharing-feedback/` | 当前实现证据 |
| 搜索、回顾、用途模板与生产可靠性 | `openspec/changes/complete-product-workflows/`、本文 §15 | 云端部署已完成的证明 |
| 跨灵感手动选材 | `openspec/changes/add-material-output/`、本文 §16 | AI 汇总、批量留档或云端部署 |
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
- 云函数入口只做两件事：从可信上下文取身份、转发给 `server/`。`cloudfunctions/linggan_api/index.js`（12 个业务 action）、`linggan_ai/index.js`（`expand` / `summarize`）、`linggan_maintenance/index.js`（保留期清理）都是这么薄。业务逻辑全部在 `server/`，以便脱离云环境单测。
- `server/` 是构建产物的唯一来源。`scripts/build-cloud.cjs` 把它同步进**三个**云函数目录，`npm run check` 断言产物与源码一致——不同步即视为失败。

## 2. 云函数协议

### 共享环境部署补充（2026-09-27）

**用户已明确授权以下四项共享适配，实施和平台验收分别记录。** 授权范围不包含共用认证函数、其他应用、全局存储规则、AI 计费启用或实际数据清理。

正式共享环境为 `product-d2g59zty74d7d1ec1`，资源方 AppID `wx7ad85943fe81e095`，本小程序仍为 `wxed8fdc5d559d973d`（`server/wx-identity.js` 的 `PROJECT_APPID`）。三个云函数同名部署在资源方环境，调用方身份仍只认本项目 AppID。

`services/cloud-client.js` 提供 `createCloudConnection({ config, getSdk })` 与 `getCloudClient()`：按 `resourceAppid`/`envId` 创建独立 `wx.cloud.Cloud` 实例，等待 `init()`；初始化抛错或返回非零 `errCode` 均视为失败，清除初始化任务以便重试，不向业务层交付未就绪实例。同次并发共享初始化，绝不回退默认云实例或旧环境。App、`wx-transport`、照片上传/删除及私有下载统一取此实例。只下载可信账户记录中的照片，临时路径不持久化、不写日志，页面退出丢弃路径和迟到回执。

`createWxStorage({ namespace })` 以 `linggan:env:资源方AppID:环境ID:` 包装所有业务键；`info()` 仅返回当前命名空间的逻辑键，容量信息仍是全小程序容量。旧环境及无前缀历史键保留，不用于 product 自动同步，不执行迁移。账户内部缓存结构和 accountKey 格式不变。

`services/private-photos.js` 的 `loadPrivatePhotos(photos, { cacheScope, isCurrent, getClient })` 仅下载配置环境中 `linggan/当前账户/` 的记录文件，通过共享实例 `downloadFile` 获得临时显示路径，不生成公开 URL、不持久化路径。单张失败仅标记该图片；页面隐藏、再次加载或账户变化时丢弃迟到结果。详情缩略图和照片查看页使用相同读取器，显示失败时不回退到未授权的默认实例。

`server/wx-identity.js` 的 `getCallerIdentity(context)` 只处理 `cloud.getWXContext()` 的可信结果：跨账号时要求 `FROM_APPID` 与 `FROM_OPENID` 成对完整，来源 AppID 必须为 `wxed8fdc5d559d973d`；不完整来源不可回退 `APPID/OPENID`。无跨账号字段的直连也仅接受本项目 AppID。返回 `{ appid, openid, accountKey }` 或 null，哈希仍为 SHA-256(appid + `|` + openid) 前 32 位。API 与 AI 共用此逻辑，请求体身份仍由协议层拒绝。

分享内容审核、AI 审核及小程序码通过 `cloud.openapi({ appid: 来源AppID })` 指定本项目，openid 取同一可信来源。官方 wx-server-sdk 2.6.3 包的 openapi 代理实现已核对支持此配置；实际跨账号审核授权及小程序码归属仍需平台验收。

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

`requestId` 由客户端以时间和随机量生成，入队时持久化；同一逻辑操作重试时**复用同一个值**。服务端将成功响应连同 `action` 与规范化 `payload` 的摘要按 `(accountKey, requestId)` 缓存。TTL 内同标识、同内容才返回成功缓存；同标识、不同内容返回 `REQUEST_ID_REUSED`，不得把前一操作的成功当作本次成功。失败响应不缓存，以免暂时性故障阻断原请求重试。这是**传输层幂等**，与 §8 的实体级幂等是两回事，两者都要有。实例内缓存不等于跨云函数实例的持久幂等保障；跨实例仍依赖版本条件写入及实体级幂等。

### 2.2 身份

身份**只能**从 `cloud.getWXContext()` 取。请求体中出现任何身份字段（`accountKey`、`openid`、`_openid`、`appid`、`unionid`）即整请求拒绝，返回 `IDENTITY_FIELD_REJECTED`，且**不写入任何数据**。

### 2.3 动作表

`linggan_api` 认识全部 12 个动作（`server/protocol.js`）。`expand` 与 `summarize` 在另一个函数 `linggan_ai`，见 §6 与 §15.3。

| action | payload | 成功返回 data | 说明 |
| --- | --- | --- | --- |
| `snapshot.pull` | `{}` | `{ cacheScope, generation, version, inspirations[], photosEnabled, storagePrefix, serverTime }` | 拉取账户全量快照；`cacheScope` 仅用于本机缓存分区，不作为认证凭据 |
| `snapshot.push` | `{ baseVersion, generation, upserts[] }` | `{ version, applied[] }` | `baseVersion` 与 `generation` 必填；按版本增量写入。`upserts` 为新增或更新的整条灵感，单次至多 21 条、`id` 不得重复 |
| `inspiration.delete` | `{ inspirationId, baseVersion, generation }` | `{ deletedPhotos, version }`；已不存在时含 `alreadyAbsent: true` | 版本与代际必填。删除前先撤销该来源的全部有效分享；含照片时委托照片闭环（§15.5） |
| `photo.delete` | `{ inspirationId, photoId, baseVersion, generation }` | `{ version, deletedPhotos }`；已不存在时含 `alreadyAbsent: true` | 单张照片的独立删除动作。照片能力关闭时返回 `PHOTO_DELETE_UNAVAILABLE`，**不得**用推送静默丢弃文件引用 |
| `share.create` | `{ inspirationId, selectedSupplementIds[], baseVersion, generation, channelIntent }` \(+\) `requestId` | `{ shareId, token, expiresAt, preview }` | 只允许这五个键；`channelIntent` 仅 `chat` / `timeline_poster`。见 §14.2 |
| `share.get` | `{ token }` | `{ title, body, createdAt, expiresAt }` | 持令牌只读，读者不必是所有者；无效/过期/撤销/源删除统一 `SHARE_UNAVAILABLE` |
| `share.listMine` | `{ before? }` | `{ items[], nextBefore }` | 本人分享列表，每页 20；不返回令牌、哈希与密文 |
| `share.revoke` | `{ shareId }` | `{ revoked: true }` | 仅所有者，重复操作幂等 |
| `share.qr` | `{ token }` | `{ pngBase64 }` | 为仍有效的令牌生成小程序码，供本机海报绘制 |
| `feedback.create` | `{ category, body }` | `{ feedbackId, category, body, status, createdAt, updatedAt }` | `category` 仅 `bug` / `idea` / `other`；正文 10—1000 字 |
| `feedback.listMine` | `{ before? }` | `{ items[], nextBefore }` | 只返回本人反馈，每页 20 |
| `feedback.reportShare` | `{ token, body }` | 同 `feedback.create` | 由有效令牌定位分享，内部以 `share_report` 落库；客户端不能指定所有者或目标账户 |

原文可以直接改写，所以服务端**不再校验 `text` 不可变**（原 `IMMUTABLE_TEXT` 已撤销）。取而代之的是一条更本质的约束：

**服务端 MUST 校验 `textHistory` 只增不减。** 客户端可以改写 `text`，但不得从历史里删掉任何一版。违反返回 `HISTORY_TRUNCATED`。这是「你说过的话不会被悄悄抹掉」这条承诺在服务端的唯一落点——客户端自己不去删，不构成保证。

两条容易记错的实现事实：

- **没有 `feedback.submit`**，提交反馈走的是 `feedback.create`。
- **`share.*` 与 `feedback.*` 不走传输层 requestId 内存缓存**（§2.1 的缓存只对非这两类前缀的动作生效）。它们各自用实体级唯一索引与 `requestDigest` 保证幂等，缓存与否必须在服务端重查，不能从缓存兜底返回。

### 2.4 删除的执行顺序

以下是原 MVP 的目标方案，**已被 §13.3 与 §15.5 的实际实现取代**：现在是先按版本 CAS 登记 `photoCleanup` 任务、逐文件删除并确认 SDK 状态、全部成功后重新 CAS 收敛，中途失败返回 `PHOTO_CLEANUP_PENDING` 并保留任务重试。云文件删除不能物理回滚，所以「删除中」是可观测的持久状态，而不是一次调用。下面保留原始三步供对照：

1. 写入 `deletedAt`（软删）。
2. 删除该灵感在云存储下的全部对象。
3. 物理移除该条灵感记录。

第 2 步失败即回滚 `deletedAt` 并返回失败，客户端**不得**移除本地数据。只有收到 `ok: true` 才清理本机记录。这与 `photo-capture` 规范中「删除确认失败则灵感与照片全部保留」一一对应。

### 2.5 错误码总表

**协议与同步层**（`server/protocol.js`、`server/repository.js`）：

| code | 触发条件 | 客户端处置 |
| --- | --- | --- |
| `UNAUTHENTICATED` | 可信上下文缺失或 openid 为空 | 提示稍后重试；不重试写入 |
| `FORBIDDEN_SOURCE` | 请求来自未获准的小程序 | 同上 |
| `IDENTITY_FIELD_REJECTED` | 请求体含身份字段（`accountKey`/`openid`/`_openid`/`appid`/`unionid`/`uid`） | 不重试，记为缺陷上报 |
| `INVALID_ACTION` | 未知 action | 不重试 |
| `INVALID_PAYLOAD` | 参数校验失败 | 不重试，提示内容不合规 |
| `REQUEST_ID_REUSED` | 同一账户在缓存有效期内以同一请求标识提交不同动作或参数 | 停止自动重试并保留本机操作，排查标识冲突 |
| `HISTORY_TRUNCATED` | 提交中删除了已有的原文历史版本 | 不重试，记为缺陷上报——这会破坏「说过的话不会被抹掉」的承诺 |
| `MERGE_TARGET_INVALID` | 汇总的指向关系不成立（目标不存在、指向自身、或形成环） | 不写入，提示汇总失败 |
| `NOT_FOUND` | 目标灵感不存在 | 刷新列表 |
| `CONFLICT` | `baseVersion` 与服务端 `version` 不一致 | 停止自动写入，保留本机意图，进入冲突态 |
| `STALE_GENERATION` | 客户端 `generation` 落后于服务端 | 停止自动回传并保留本机队列，取得云端快照后让用户确认恢复方式 |
| `LIMIT_EXCEEDED` | 超出条数 / 长度 / 大小上限 | 提示具体上限，不回滚已成功的部分 |
| `SERVICE_UNAVAILABLE` | 协议层依赖未就绪 | 提示稍后重试 |
| `INTERNAL` | 未预期错误 | 保留输入，可重试 |

**照片闭环**（同一信封，动作见 §2.3、约束见 §15.5）：

| code | 触发条件 | 客户端处置 |
| --- | --- | --- |
| `PHOTO_DELETE_UNAVAILABLE` | 照片能力关闭时收到照片删除 | 不重试；入口本就不该出现，出现即记为缺陷 |
| `PHOTO_REMOVE_REQUIRES_ACTION` | 用推送直接丢弃照片引用，而未走 `photo.delete` | 不重试，改为独立删除动作 |
| `PHOTO_PATH_INVALID` | 文件 ID 不属于当前环境、账户或记录 | 不重试，且**不得**把该引用写进记录 |
| `PHOTO_CLEANUP_PENDING` | 云文件尚未全部删除，任务已登记 | 保留任务与记录，稍后重试；**不得**报告删除完成 |
| `PHOTO_RECOVERY_UNAVAILABLE` | 含照片的冲突切换遇到旧服务端或照片能力关闭 | 保持原冲突状态，不切换 |

**分享与反馈**：`share.*` 与 `feedback.*` 的专属码（`SHARE_NOT_CONFIGURED`、`SHARE_UNAVAILABLE`、`SHARE_LIMIT`、`SHARE_CONTENT_REJECTED`、`SHARE_REVIEW_UNAVAILABLE`、`SHARE_RETRY_UNAVAILABLE`、`SHARE_TOO_LONG`、`BACKUP_PENDING`、`TOKEN_OR_QR_FAILED`、`FEEDBACK_LIMIT`、`RATE_LIMITED`、`RATE_LIMIT_UNAVAILABLE`）与页面处置见 §14.4；这些动作不过传输层缓存，必须由服务端重查决定结果。

**只存在于本机**（不来自云端）：`LOCAL_WRITE_FAILED`（本机存储写入失败，见 §7.5）、`ACCOUNT_SESSION_CHANGED`（账户会话已切换，迟到结果作废，见 §15.5）、`AI_*` 系列（见 §6）。

### 2.6 三个云函数与平台配置

代码里是三个函数，不是一个。它们的入口都只做「取身份 → 转发」，差别在配置与开关。

| 函数 | 承载 | 环境变量（非密钥） | 密钥 | 云调用权限 | 平台超时 |
| --- | --- | --- | --- | --- | --- |
| `linggan_api` | §2.3 的 12 个 action | `LINGGAN_SHARE_KEY_ID`、`LINGGAN_SHARE_CREATE_ENABLED`、`LINGGAN_SHARE_CODE_VERSION`、`LINGGAN_PHOTOS_ENABLED`、`LINGGAN_STORAGE_PREFIX` | `LINGGAN_SHARE_TOKEN_KEY`（32 字节 hex）、`LINGGAN_SHARE_PREVIOUS_KEYS`（轮换映射） | `security.msgSecCheck`、`wxacode.getUnlimited` | 未在仓库声明 |
| `linggan_ai` | `expand`、`summarize` | `LINGGAN_AI_ENABLED`、`LINGGAN_AI_MODEL`、`LINGGAN_AI_DAILY_LIMIT`（默认 20）、`LINGGAN_AI_MINUTE_LIMIT`（默认 3） | 无（走平台 AI，不需自建供应商密钥） | `security.msgSecCheck` | **启用前须 ≥60 秒**，服务端业务截止 50 秒、客户端 55 秒 |
| `linggan_maintenance` | 保留期清理 | `LINGGAN_MAINTENANCE_ENABLED`（默认关闭） | `LINGGAN_MAINTENANCE_TOKEN`（≥32 字符） | 无 | 未在仓库声明 |

三条要记住的事实：

- **`config.json` 里只有 `permissions.openapi`，没有超时与内存字段。** 超时目前只体现在 `deployment/product/manifest.json` 的 `minimumTimeoutSecondsBeforeEnable` 与部署手册里；`linggan_api` 的平台默认值是多少，代码看不出来，必须在控制台核对。把「仓库里没写」当成「够用」是这类项目最常见的翻车方式。
- **密钥缺失时分享创建失败关闭**，不影响既有的记录、备份与反馈；`LINGGAN_SHARE_CREATE_ENABLED` 只在显式 `false` 或其他无效值时才暂停创建。
- **维护函数默认无触发器、无执行**。只有持 `LINGGAN_MAINTENANCE_TOKEN` 的服务端调用、且 `LINGGAN_MAINTENANCE_ENABLED=true`、且显式传 `dryRun:false` 才会真正删除数据；其余情况一律只演练。

清单与执行顺序见 `deployment/product/`，平台侧进度见 `docs/DEPLOYMENT.md` 与 `openspec/changes/deploy-product-release/tasks.md`。

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

> **本节描述的是 v1 布局，已被 §13.2 取代。** 现行为按可信作用域分区、单键原子写入的
> `linggan:env:<资源方AppID>:<环境ID>:linggan:v2:<cacheScope>:state`（见 §13.2、§13.5，实际键名见 `services/wx-storage.js` 与 `services/store.js`）。
> 旧 `linggan:v1:*` 键原样保留、不读取、不迁移。下面保留 v1 的形态与当时的取舍，作为为什么改成单键分区的背景。

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
      foldedAt: null }         // 被并入正文的时刻（收起行显示「已并入灵感」）
    // source 取值：'user' | 'ai'，AI 产出必须标为 'ai'
  ],
  photos: [
    { id: 'pho_…', fileId: 'cloud://…', createdAt: 1758500000000 }
    // 只有上传成功（fileId 有效）的照片才写入此数组
  ],
  tags: ['内容选题', '城市散步'],   // 至多 5 个，单个 12 字，不重复；旧记录缺省为 []
  stage: 'seed',                  // 'seed' | 'growing' | 'ready'（想法 / 整理中 / 可使用）
  source: 'user',                 // 当前正文的来源：'user' | 'ai'；AI 后续编辑仍保留标记
  summarySources: [],             // 汇总追溯：来源灵感 id，最多 20 个；不复制正文
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
- **灵感汇总**：结果写回某一条灵感（**由用户在界面明确选择目标，见 §11 第 9 项**），其余被汇总的灵感写 `mergedInto: <目标灵感的 id>`。若结果覆盖了目标灵感的 `text`，旧原文照常压入它的 `textHistory`——两个机制在这里自然衔接，不需要额外规则。

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
| 并入正文 | `foldIntoText` | 内容追加进 `text`，本条写 `foldedAt` | `unfoldSupplement` 可恢复 |

> **术语对照（2026-09-28 校对）**：界面上的动作名是「**并入正文**」，收起行写「**N 条已并入灵感**」；代码里叫 `foldIntoText` / `foldedAt`——那个名字描述的是机制（把内容折进正文）。规范 `inspiration-capture` 把这条要求写作「合并进灵感」，**规范用词与界面用词不同是有意的**，不要为了统一去改其中一边：改规范要提案，改界面会让按钮失去具体对象。
> **「合并」在本产品里有两个用法，指向不同目标**：这里的并入的是**灵感原文**（`foldedAt`），AI 汇总的覆盖并入的是**汇总结果**（`mergedInto`）。界面文案必须让目标可分辨，不能只写「合并」。
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
| `syncing` | `conflict` | 收到 `STALE_GENERATION` 或 `REQUEST_ID_REUSED`，停止自动回传并保留本机内容 |

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

> **本节写的是客户端与 `linggan_ai` 之间的契约形态，服务端的实际接线见 §15.3。**
> 当前实现比这里多几层：请求必须带唯一请求 ID，服务端先按账户预留额度、审输入、调模型、解析 JSON、
> 过契约校验、再审输出；`createModel('cloudbase')` 来自环境变量配置的模型名。本节不再重复额度与审核细节。

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
foldIntoText(inspiration, { supplementId, historyId, now }) → Inspiration   // 界面动作名「并入正文」
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

**历史方案，已移出小程序包至 `qa/legacy/store.js`。** 以下接口只供旧规范测试，当前入口使用 §17 的云确认存储。

本机状态与持久化。**存储与网络都从外面注入，不直接依赖 wx**——这是让降级路径可测的唯一办法：

- 离线、配额耗尽、同步失败，在真机上很难稳定复现，而它们占了规范里一半的场景。
- 注入之后，这三条路径都能在 Node 里直接断言。

```js
// 模块级导出
createStore({ storage, transport, now, cacheScope, remoteSnapshot, newRequestId? }) → Store
emptySnapshot() → Snapshot
```

`Store` 实例上的方法：

```js
readSnapshot()               → Snapshot
readQueue()                  → Op[]
getConflict()                → Conflict | null
getBackupStatus()            → BackupStatus
getRecoveries()              → Recovery[]      // 冲突时留存的本机只读副本，见 §13.5
retryPending()               → Promise<SaveResult>
resolveUseRemote()           → Promise<SaveResult>  // 用户确认「采用云端版本」，先留存副本再原子切换
saveInspiration(inspiration) → Promise<SaveResult>
saveInspirations(items) → Promise<SaveResult> // 同一批次原子快照与一条队列，服务端一次 CAS
deleteInspiration(id)        → Promise<SaveResult>
deletePhoto(inspirationId, photoId) → Promise<SaveResult>  // 队列 kind:'photoDelete'，见 §15.5
listInspirations()           → Inspiration[]
getInspiration(id)           → Inspiration | null
```

`createStore` 还接受可选的 `isCurrent()` 会话守卫（见 §15.5）：每次发送前与响应返回后核验，失效即以 `ACCOUNT_SESSION_CHANGED` 拒绝继续使用旧实例。

每条操作入队时通过 `newRequestId`（默认随机标识生成器）生成并持久化 `requestId`；本机序号不单独承担跨设备唯一性。首次发送前持久化 `baseVersion`。重试同一条操作复用两者。

`transport.send(action, payload, meta)` 的第三个参数是 `{ requestId }`，与上面是同一个值。

`deleteInspiration` 使用独立删除动作；云端未确认时仍显示并保留本机记录。旧的「先软删」描述由 §13 覆盖。

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

**历史方案，已移出小程序包至 `qa/legacy/wx-storage.js`。** 当前小程序不使用微信键值存储持久化业务记录。

把 wx 的同步存储包装成 `store` 需要的接口。**唯一需要注意的是配额异常原样上抛**，不吞、不转成静默失败。

```js
// 模块级导出
createWxStorage({ namespace }?) → Storage
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
| `append` | 成为一条全新灵感 | 保持原样、独立可见 |

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
createRepository({ db, now, beforeRemove?, photosEnabled?, validatePhoto?, removeFiles? }) → Repository
emptyAccount(accountKey, now)              → Account        // 初始账户文档
```

```js
// Repository 实例上的方法
pull(accountKey)                        → Promise<Result>
push(accountKey, payload)               → Promise<Result>
remove(accountKey, payload)             → Promise<Result>
removePhoto(accountKey, payload)        → Promise<Result>   // 单张照片，见 §15.5
```

`db` 需要实现 `get(accountKey)` / `put(accountKey, doc)`，**都是异步的**——微信云数据库就是异步的，早期写成同步接口是个不匹配，已改。

`push` 的三道校验缺一不可：

1. **代际**：客户端 `generation` 落后 → `STALE_GENERATION`，停止旧队列自动回传，保留本机内容供用户恢复。这保证已清理的数据不会被离线旧设备自动回传。
2. **版本**：`baseVersion` 不一致 → `CONFLICT`，不自动合并、不覆盖。
3. **历史只增不减**：客户端可以改 `text`，但不得从 `textHistory` 里删掉任何一版 → `HISTORY_TRUNCATED`。**这是「你说过的话不会被悄悄抹掉」在服务端唯一的落点**——客户端自己不去删，不构成保证。

`remove` 含照片时委托 §15.5 的两阶段清理：先登记任务再删文件，**不是**一次调用就能回滚的动作。「图片已删但灵感还在」的中间状态由 `photoCleanup` 任务显式表达，不假装不存在。

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
- **传输幂等**：`(accountKey, requestId)` 与动作、参数摘要绑定；TTL 内同内容重试返回成功缓存，不同内容报 `REQUEST_ID_REUSED`。暂时性失败不缓存。云函数实例内缓存不保证跨实例全局去重，版本条件写入与实体幂等仍是必需防线。
- **图片幂等**：存储对象名固定为 `linggan/{accountKey}/{inspirationId}/{photoId}`，重传覆盖同一对象而非新增，因此重试不会产生重复文件。本机文件路径（§3.3）同样以 `photoId` 结尾，重试覆盖同一文件。
- **冲突**：`baseVersion` 与服务端 `version` 不等即返回 `CONFLICT`。客户端不自动重试、不自动合并、不覆盖，保留本机意图并进入 `conflict` 态等待用户处理。
- **代际**：客户端在每次 push 时携带自己记录的 `generation`。服务端代际更高时返回 `STALE_GENERATION`，客户端保留本机队列但停止自动回传，待用户决定恢复方式。

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
| 3 | AI 走云开发内置能力，还是自建调第三方 | **已定（后续变更）**：走云开发 AI，`@cloudbase/node-sdk` 锁定 3.16.0，`app.ai().createModel('cloudbase')`；模型名由环境变量给。见 §15.3 |
| 4 | `requestId` 缓存的服务端 TTL | **代码基线为 10 分钟**；仅云函数实例内缓存（上限 500 条，超限清空），跨实例仍依赖版本条件写入 |
| 5 | 本机存储布局：单键快照，超 1MB 触发分片 | **已定**，理由与触发条件见 §3.2 |
| 6 | 保存与同步是否合并为一个动作 | **已定（2026-09-22 你的决定）**：保存后自动同步云端，失败则提示；界面不区分本机与云端。见 §3.4 |
| 7 | 原文改为可编辑，并保留历史版本 | **已定（2026-09-22 你的决定）**：取代原「原文不可改写」这条 Requirement。见 §4.1 |
| 8 | 「覆盖」时被汇总的内容只标记不删除 | **已定（2026-09-22 你的决定）**：见 §4.2 |
| 9 | 灵感汇总「覆盖」时，汇总结果写回哪一条 | **已定（后续变更）**：由用户在界面明确选择目标，**没有默认值**。见 §15.3、`pages/ai-workbench` |
| 10 | 汇总的长度上限（`items` 条数、拼接总字符数、`summaryMaxLength`） | **已定（后续变更）**：来源至多 20 条、合计 12000 字，结果至多 2000 字；取值见 §7.3，仍标注为「实施时取的保守默认」 |

第 6 项按你的决定改定了。原来写的「按云开关分两档判定」已作废，界面上的「待同步」常驻标记与「数据只在这台手机上」告警也一并去掉。

**但这处决定与 `inspiration-capture` 规范的措辞有出入，需要处理。** 规范写的是「系统 SHALL 在云端确认后才向用户报告保存成功」「不得呈现为已保存」，而新方案在同步失败时会说「已保存。还没同步到云端，会自动重试」。

我的判断是新措辞更诚实——数据确实已经在本机落定，谎报「没保存成功」会让用户重打一遍，那是更糟的错。但**规范原文与实现不一致这件事必须解决**，否则本变更归档时对不上。改规范属于提案范畴，我不擅自改；你说了我再动。

## 12. 内容输出（`add-content-output`）

本节属于独立变更 `openspec/changes/add-content-output/`，不改变账户文档字段。`services/content-output.js` 只读传入的灵感对象：`currentSupplements(item)` 返回按创建时间排序的有效补充；`buildUseText(item, selectedIds)` 生成正文与选中补充的干净纯文本；`buildArchiveText(item, generatedAt)` 生成带时间、历史和收起标记的留档文本。三者不写存储，也不调用 `wx`。

`pages/detail` 的复制入口收在页内「更多」面板，操作反馈仍内联在页面；`pages/output` 进入即构建可编辑的自由稿（补充默认全选），工具行为「调整内容 / 选择格式 / 更多」，面板改动先暂存、点「应用选择 / 应用格式」才写回，用户手工改过稿件时先弹替换确认。整理稿另存时调用既有 `createInspiration` 和 `store.saveInspiration`，因此沿用 2000 字上限、账户隔离和保存状态。TXT 文件由页面在用户点击后写入 `wx.env.USER_DATA_PATH`，页面继续提供文字预览；用户再次点击后才调用 `wx.shareFileMessage` 选择发送去向。离开页面时尽力清理小程序内的临时文件。不自动分享，不含照片；外部副本不会随原记录删除，页面明确提醒。

## 13. 云同步整改（`repair-cloud-sync`）

本节为新变更的实施约束；§3.2 与 §5.1 中的 `linggan:v1` 全局缓存、无重试队列及「同步失败会自动重试」描述是旧实现，不可作为已完成事实。客户端不得仅凭旧全局键展示个人内容。

### 13.1 服务端版本门控

`snapshot.pull` 返回受信上下文推导的 `cacheScope`（稳定不透明字符串）、`generation`、`version`、`inspirations`。`cacheScope` 只用于客户端选择本机分区，不在后续请求中充当身份。`snapshot.push` 与 `inspiration.delete` 必须提交非负整数 `baseVersion` 和正整数 `generation`；缺字段或类型不符返回 `INVALID_PAYLOAD`，代际不符返回 `STALE_GENERATION`，版本不符返回 `CONFLICT`。仓库读到的版本与数据库最终写入之间还需条件更新，更新数为 0 时按冲突处理。请求体中的身份字段仍整请求拒绝。

### 13.2 本机分区与旧数据

新本机键为 `linggan:v2:<cacheScope>:state`，单键保存当前快照、待处理操作与备份状态，避免「快照写成、队列写失败」的两键半提交。`cacheScope` 必须由成功的 `snapshot.pull` 提供且通过安全字符校验；启动时未取得可信作用域，不读旧全局缓存、不显示任何缓存正文，也不把新写入挂到猜测的账户。旧 `linggan:v1:*` 键原样保留，真实数据的归属确认与迁移另行授权。

本机单键写入异常时保存返回失败，页面保留输入。读到损坏的 v2 状态时停止写入并提示恢复，不能把损坏状态当空快照覆盖。没有待处理操作时可用云端快照更新本机；有待处理操作时不得用 pull 覆盖本机稿。

### 13.3 队列、冲突与删除

每次用户写入产生一个稳定 `requestId`，与操作内容、代际及首次发送时确定的 `baseVersion` 一起持久化。同一账户串行处理队列；网络失败时保留，回到前台或用户主动重试时有界重试。`CONFLICT` / `STALE_GENERATION` 不自动覆盖或无限重试，必须保留本机稿和云端基线供用户处理。删除动作不得伪装成带 `deletedAt` 的普通 upsert：调用 `inspiration.delete`，云端确认后才从本机移除。照片清理在正式接线前要解决部分成功无法物理回滚的边界；不能把云文件删除失败当作「所有文件都原样保留」。

应用在前台收到网络恢复事件时再触发一次有界队列处理；若尚未取得可信作用域，则重新执行 `snapshot.pull`，不凭旧分区键离线解锁。后台不发起恢复请求。「我的」页可在网络恢复后刷新可见备份状态，离开页面时移除自身监听。事件触发只表示可以尝试网络请求，不表示云端已确认写入。

用户选择「采用云端版本」时，客户端先重新拉取可信账户的最新快照，再用**同一次本机写入**把当前快照和未确认队列存入该账户的只读 `recoveries[]`，同时以新云端快照替换活动快照并清空活动队列。单键写入失败则保持原冲突状态与原队列，不能部分切换。每次启动拉取更新活动快照时必须保留 `recoveries[]`；恢复副本可查看、复制，不自动回传云端或自动删除。这个动作须由用户在说明后明确确认，不能在冲突发生时自动执行。该方案只提供安全的「采用云端并保留本机副本」路径，不声称自动合并。

恢复副本保留完整文字与照片引用，并通过私有照片预览页查看。仅在可信服务端确认照片能力时允许含照片冲突切换；旧服务端或能力关闭时仍返回 `PHOTO_RECOVERY_UNAVAILABLE`，保持原状态。文字留档始终排除照片。

### 13.4 发布兼容

服务端严格要求版本字段会拒绝旧客户端请求。上线顺序必须包含旧客户端兼容策略、云函数与客户端版本配套、受控账户回归以及回滚预案。本节的代码实现不等于这些外部步骤已完成。

### 13.5 本轮客户端接口

`createStore({ storage, transport, now, cacheScope, remoteSnapshot, newRequestId? })` 只接受 `snapshot.pull` 返回且通过安全字符校验的 `cacheScope`。创建时仅读取 `linggan:v2:<cacheScope>:state`；损坏状态抛错并停写，不以空快照覆盖。`remoteSnapshot` 在没有待处理操作时更新本机基线；有操作时保留本机快照与队列。`readSnapshot()`、`readQueue()`、`listInspirations()`、`getInspiration(id)` 为只读；`saveInspiration(item)` 原子写入快照和队列；`deleteInspiration(id)` 用独立删除动作且云端确认前仍保留记录；`retryPending()` 串行处理至多三条操作；`getBackupStatus()` 返回备份状态；`getConflict()` 返回冲突时保留的远端快照。旧 `v1` 服务模块接口不再用于应用入口。

新增 `getRecoveries()` 读取只读副本，`resolveUseRemote()` 执行用户确认后的重新拉取和原子切换。`recoveries[]` 不参与正常推送。只要恢复副本仍在，就不得在启动同步时覆盖它；副本写入失败时返回明确错误，原冲突与待处理操作保持不变。

应用启动及每次回到前台先置 `store = null`，再拉取当前受信账户作用域；拉取失败时不打开任何个人缓存。拉取成功后构建对应分区的 store 并触发有限重试。页面必须等待启动结果再展示数据；切换账户时原页面先清空已渲染的旧数据。首次离线无法验证身份时，保留输入草稿但暂停持久化，不把内容写入猜测的账户。

## 14. 分享与意见反馈（`add-sharing-feedback`，本地代码已实现、平台待验收）

本节是分享与反馈的实施设计，已有对应本地代码，但不是已上线能力。详情页的 TXT 发送仍不能作为可撤销分享；“我的”页将微信原生反馈与本产品内意见反馈分开。新页面与云函数动作已写入源码；新集合、索引、权限、审核云调用、正式部署与真机体验**尚未取得验证证据**。字段和索引见 `docs/database-design.md` §10。

### 14.1 入口、页面与文案

| 入口/页面 | 行为 | 状态与文案 |
| --- | --- | --- |
| “我的”→“分享小程序” | 微信聊天卡片；公共入口页可调用 `onShareTimeline` | 只带公共品牌文案和入口路径，不读取个人内容，不创建个人分享记录，也不写“已发送” |
| 详情→`pages/share-preview/index` | 选择当前正文与有效补充，完整预览，确认 30 天有效期 | “拿到分享链接的人都能查看”；确认前不创建；备份未完成或冲突时禁用确认；主按钮按状态替换「确认内容并准备分享 → 准备中… → 选择微信好友」，修改选择立即使已准备结果失效且不报“已发送” |
| “发给微信好友” | 创建快照后用 `button open-type="share"` 触发聊天卡片 | 只说“分享内容已准备好”，不把打开选择器视为发送成功 |
| “发朋友圈” | 创建快照，生成分页文字海报及小程序码；用户保存后自行发布 | “海报已保存，请到朋友圈自行发布”；失败按生成/保存区分，不说已发布 |
| `pages/shared/index` | 从聊天 `?t=` 或海报码 `scene=s=` 解析令牌，调用只读接口 | 有效时仅展示分享快照；无效/撤销/过期/源删除统一“分享无法查看 / 分享已失效，可请分享者重新发送”，不给重试；网络等其他失败写“暂时无法查看 / 请稍后重试。”并给“重新读取”，可举报 |
| “我的”→`pages/my-shares/index` | 查看本人记录、撤销、重新创建并分享 | “可查看/已过期/已撤销/已失效”；源记录不存在或代际变化时标“已失效”；渠道写“用于聊天/朋友圈”，不写“已发出”；快照清理后只保留时间与状态 |
| “我的”→`pages/feedback/index` | 提交意见、查看本人反馈 | “反馈已收到/提交失败”；状态“已提交/处理中/已关闭”，不承诺回复时间 |

`pages/shared/index` 独立只读渲染，不复用所有者详情页；接收者不能编辑、浏览分享者其他记录或看到照片、昵称、账户身份。分享页仍禁止页面索引，但令牌校验才是访问控制。正文用纯文本组件展示，不把用户文字拼进富文本/HTML。公共入口不携带 `accountKey`、OpenID 或私人查询参数。

### 14.2 分享快照与创建协议

快照由**已云端确认**的当前正文及用户勾选的当前有效补充组成，沿用 §12 的有效补充语义；默认全选有效补充。它不含 `textHistory`、`contentHistory`、收起项、照片及 `fileId`、AI 中间数据或其他灵感。正文或补充后来修改，已分享快照不变；要更新须重新确认并创建新分享。总文字不超过 6000 字，不静默截断；公开内容安全检测失败时不落库，不生成海报。现有 AI 内容校验不能充当公开分享审核。

`share.create` 请求为 `{ action:'share.create', payload:{ inspirationId, selectedSupplementIds, baseVersion, generation, channelIntent }, requestId }`；`channelIntent` 仅 `chat` 或 `timeline_poster`，只表示意图。服务端仅从可信微信上下文取所有者，在 `linggan_accounts` 中核对代际、版本、来源和所选补充；客户端不得提交正文、身份或令牌。服务端使用密码学安全随机源生成 28 位字母数字令牌（约 167 bit 熵），保存 SHA-256 哈希及服务端加密密文。`(ownerAccountKey, requestId)` 与 `tokenHash` 唯一；同请求、同参数重试返回同一分享与令牌，同 ID 不同参数返回 `REQUEST_ID_REUSED`。密钥只在云函数侧并带 `keyId`，未配置不得开启。成功只返回 `{ shareId, token, expiresAt, preview }`；令牌不得进入日志、分析事件或长期本地缓存。

默认有效期 30 天，无永久选项；每账户最多 20 条有效分享、每日创建 10 条，触限 `SHARE_LIMIT`。§15.1 的事务配额与业务记录同写，真实数据库并发仍须验收。`share.listMine` 不返回令牌、哈希和密文；“重新分享”创建新快照/新令牌，不恢复旧链接。朋友圈海报另设 **1800 字、最多 9 页**的可读性边界；超出时确认按钮禁用，提示缩小分享范围或改用聊天卡片，不生成不完整海报。

聊天路径 `/pages/shared/index?t=<token>` 只在 `share.create` 成功后生成；无令牌不得发出带私人预览的卡片。海报码采用 `scene=s=<28 位令牌>`，共 30 个 ASCII 字符，对应 `pages/shared/index`；生成时不记录明文令牌。海报使用与分享页相同快照，按可读字号分页、显示页码/总页数，首尾页放码；禁止截断或只输出前 N 字。一页失败则整组不报告完成。相册权限拒绝时保留聊天分享入口。已外发的图片、截图和复制文字无法远程收回，确认页及撤销结果均需说明。

### 14.3 读取、撤销及删除一致性

| 动作 | 授权及参数 | 返回和失败 |
| --- | --- | --- |
| `share.get` | 持令牌只读；完整小程序模式经 `linggan_api`，读者不必是所有者，但用平台上下文限流 | 只返回 `title/body/createdAt/expiresAt`；无效、过期、撤销或源删除统一 `SHARE_UNAVAILABLE` |
| `share.listMine` | 可信所有者，游标分页、按创建时间倒序 | 本人的摘要、来源灵感 ID、时间、渠道意图与状态；不含令牌、收件人或查看者；来源 ID 仅用于本人重新预览并创建新分享 |
| `share.revoke` | 可信所有者 + `shareId`，重复操作幂等 | 标记 `revokedAt` 后新读取立即拒绝；非所有者统一 `NOT_FOUND` |
| `feedback.create/listMine` | 可信账户；输入校验、限流、分页 | 只返回本人反馈；失败保留本机表单，不返回后台字段 |
| `feedback.reportShare` | 有效令牌 + 可信阅读者身份 | 服务端由令牌定位分享，不接受客户端指定所有者、状态或反馈目标账户 |

令牌是持有即有查看权的凭证，**可被转发**，不能宣称“只有指定好友可看”。`share.get` 每次校验哈希、到期、撤销，再校验来源账户 `generation` 与 `inspirationId` 仍存在且未删除；任一步失败均拒绝，不从缓存兜底。删除来源时先使关联分享失效，再走原删除协议；即使跨集合操作中断，读取时的来源校验仍应在源删除后拒绝。账户清空/代际变化使旧分享失效。跨文档一致性和失败重试须有服务端测试。

朋友圈原生 `onShareTimeline` **首版只用于公共入口**：该接口只能对当前页面提供 `query`，朋友圈打开为单页模式；云开发对未登录模式默认拒绝访问（[CloudBase 分享说明](https://docs.cloudbase.net/recipes/add-share-with-params-miniprogram)、[权限说明](https://docs.cloudbase.net/error-code/PERMISSION_DENIED)）。不得为内容页直接打开现有共享云环境的匿名权限。未来原生内容卡片须先有独立的匿名只读边界、共享环境影响评估、删除失效证明、限流及真机验证，并另行授权部署；目前由用户手动发布文字海报满足朋友圈内容展示。

### 14.4 反馈与错误边界

反馈类别 `bug/idea/other`；分享页举报走 `share_report`。正文去首尾空白后 10—1000 字，不收照片、文件或独立联系方式；页面提示避免写入敏感信息。**客户端在正文不足 10 字时置灰提交按钮，并在计数处写明还差几字**（2026-09-30 补），与记录页「无内容即置灰」保持同一规则，不等到提交失败才提示。每账户每天最多 5 条反馈，举报同一分享每账户每天最多 1 条，超限 `FEEDBACK_LIMIT`。状态由服务端初设 `submitted`，`reviewing/closed` 只允许后台受权人员改；客户端不得提交状态、回复或其他用户 ID。反馈入口只有一个，按钮文案「提交反馈」（2026-09-30 用户决定：不写「向微信反馈」），当前接微信原生 open-type 通道；自建反馈页的入口暂时隐藏（共享云环境未联通，提交无法落库与查阅），反馈页与分享举报路径保留，云环境接通后恢复——恢复时需重新区分两个通道的命名。

| 错误码 | 页面处理 |
| --- | --- |
| `BACKUP_PENDING/CONFLICT/STALE_GENERATION` | 保留预览，先完成备份或解决冲突，不创建分享 |
| `SHARE_CONTENT_REJECTED/SHARE_LIMIT` | 提示可操作原因，不生成凭证 |
| `SHARE_UNAVAILABLE` | 统一不可查看态，不透露令牌是否存在 |
| `TOKEN_OR_QR_FAILED/ALBUM_SAVE_FAILED` | 不说“已发朋友圈”，可重试或改用聊天分享 |
| `FEEDBACK_LIMIT/INTERNAL` | 保留输入，不说“反馈已收到” |

验收分别记录协议/纯函数测试（快照白名单、隔离、令牌、幂等、限流和失效）、`npm test`/`npm run check`/OpenSpec、受控云端索引与权限、开发者工具页面、iOS/Android 真机聊天卡片、相册保存、朋友圈手动发布及扫码、双账户与删除/撤销后的即时失效。缺任何层证据都不能宣称整个功能已上线可用。

### 14.5 本轮实现模块与接线

原有分享服务已使用 §15 的原子配额适配器，业务快照格式不变。

`server/sharing-feedback.js` 新增 `createSharingFeedbackService({ db, now, tokenKey, keyId, checkPublicText, generateCode })`，对外提供 `createShare/getShare/listMine/revokeShare/getShareCode/createFeedback/listFeedback/reportShare/revokeForSource`。`db` 为可注入的账户、分享、反馈读写适配器；服务端业务代码不直接依赖 `wx`。`server/protocol.js` 接入 `share.create/get/listMine/revoke/qr` 与 `feedback.create/listMine/reportShare`，沿用原信封与可信身份；创建动作要求持久化 `requestId`。`server/repository.js` 的 `createRepository` 可选接收 `beforeRemove(accountKey, inspirationId)`，在源记录版本校验后、删除写入前使相关分享失效；旧调用不传时保持原行为。

云函数入口只注入云数据库、云调用、时间和密钥。按 2026-09-27 用户授权，`LINGGAN_SHARE_CREATE_ENABLED` 未设置、空串或 `true` 时默认允许创建；`false` 或其他无效值暂停创建。入口将解析结果作为布尔值 `createEnabled` 传给服务，服务仍只接受显式 `true`。分享密钥缺失时 `share.create` 必须失败关闭，不影响既有记录/备份动作。公开文字审核不可用时不得创建分享。关闭创建开关仍保留有效链接的读取与撤销，以及意见反馈，用作安全回退。`share.qr` 只为仍有效的令牌生成小程序码，返回图片数据供本机海报绘制，不上传用户照片或永久码文件。客户端新增 `services/sharing.js` 负责协议调用；页面不直接访问数据库。列表游标使用服务端按时间前缀生成的 `_id`，同毫秒随机后缀仅用于稳定排序。

## 15. 剩余能力实施

### 15.1 分享可靠性

公开文字审核使用 `security.msgSecCheck` v2，OpenID 从当前可信微信上下文获取，scene=4。文本按 Unicode 字符拆分为每块至多 600 字符，逐块要求返回码 0 且 `result.suggest=pass`；缺少上下文、审核异常、未知结论均不创建分享。该适配器需受控云调用验证。

`createCloudSharingDb({ db, accounts, now })` 提供既有分享数据接口，内部使用 `linggan_usage` 事务守住业务写入与配额；不依赖进程内锁。`createSharingFeedbackService` 增加必需的 `rateLimit(accountKey, action)` 注入，所有对外分享/反馈动作先检查频率；内部源删除撤销不受用户限流阻断。`createCloudRateLimiter({ db, now })` 返回该回调，固定窗口参数见数据库设计 §11；未注入/调用失败返回 `RATE_LIMIT_UNAVAILABLE`，触限 `RATE_LIMITED`，不进入正文查询或码生成。

`createRetentionService({ db, now }).run({ dryRun, limit })` 按有界批次扫描和条件清理，返回分类型候选/成功/失败计数，不返回用户正文或令牌。`createMaintenanceHandler({ run, context, env })` 拒绝带可信 `OPENID/FROM_OPENID` 的客户端调用；要求服务端环境 `LINGGAN_MAINTENANCE_TOKEN` 与请求 token 常量时间比对。只有 `LINGGAN_MAINTENANCE_ENABLED=true` 且 `dryRun===false` 才执行清理，其余已认证调用仅演练；密钥不在定时器仓库配置里。`linggan_maintenance` 默认无定时触发器，不部署/执行即不会清理数据。

官方 API 依据：[CloudBase 服务端事务](https://docs.cloudbase.net/en/database/transaction)、[微信云 SDK 接口](https://github.com/wechat-miniprogram/wx-server-sdk/blob/master/index.d.ts)。实际 SDK 与索引须受控验证；声明原子设计不等于已经实测云端并发。

### 15.2 找回与使用

`services/discovery.js` 导出 `searchInspirations(items,{query,filter,stage,now})` 与 `createReviewService({storage,cacheScope,now})`。搜索大小写不敏感、匹配正文、有效补充及标签，最长输入 100 字；返回 `item/matchText/matchSource`，不查询历史/图片，不记录关键词。筛选 `all/supplemented/recent/merged`，最近为 7 天，已合并单独展示；阶段为 `all/seed/growing/ready`。排序沿用更新时间倒序，匹配片段保留命中词，不作为全文摘要。

回顾只选择两天前未更新的有效记录；每天固定一个 ID，跳过或该记录不存在时不换另一条；无候选不强推。只保存 ID 和开关，页面每次从当前 store 读取正文。关闭/跳过的存储失败时保留可重试提示，绝不影响记录本身。设置属于当前设备的当前账户，不承诺跨设备同步或消息提醒。

`services/content-output.js` 增加 `USE_TEMPLATES`、`buildTemplateText(item,selectedIds,templateId)`。五种为自由稿、社交内容、短视频脚本、工作提纲、行动清单；模板只给内容加用途结构和待编辑空项，所有原始文字原样保留。页面 `templateId/draftEdited` 仅会话态；重新生成覆盖编辑前确认，取消不改稿，可直接返回编辑。

### 15.3 AI 与确认写入

`server/ai-service.js` 的 `createAiHandler({enabled,generate,moderate,quota,contract,timeoutMs})` 只接受可信上下文、白名单文本字段与唯一请求 ID。先校验长度、重复来源和身份字段，再原子预留配额、审查输入、调用 CloudBase 模型、JSON 解析、契约校验及输出审查。审核也受频率限制，明确失败退款但不退频率。超时和审核不可用均失败关闭；无正文或图片日志。`createCloudModel({app,modelName})` 按 [CloudBase Node SDK](https://docs.cloudbase.net/ai/model/nodejs-access) 调用 `app.ai().createModel('cloudbase').generateText`，模型名由环境配置，客户端无模型凭据。审核按 Unicode 字符分块，每块至多 600 字符、2400 UTF-8 字节。

`server/ai-quota.js` 按账户及上海自然日计算额度，默认 20 次/日、3 次/分钟，可在环境变量向下调整。每日文档保存请求 ID 哈希与终态，不保存输入、输出、OpenID。相同请求不会跨实例重复调用；明确失败退还日额度，超时不退款以防迟到调用绕过成本上限。分钟频率不退款。未经配置与验收时 AI 客户端/服务端均关闭。

Node SDK 以自身 `tcb.SYMBOL_CURRENT_ENV` 绑定当前云函数环境，不复用其他 SDK 的常量，依据[环境初始化文档](https://docs.cloudbase.net/api-reference/server/node-sdk/env)。当前锁定 3.16.0；官方已提示 Node SDK 维护迁移，后续升级到跨端 SDK 须独立做真实接口兼容验证，不能仅换包名。

`pages/ai-workbench` 统一处理扩展与两种汇总。选定来源后生成；AI 草案逐条选择、编辑，未确认不持久化。离开或账户代际改变使迟到结果作废。采纳前比较生成时的来源快照，来源已改变则要求重新生成。汇总无默认写入方式，覆盖时用户明确选择目标；另存不改来源。`summarySources/sourceIds` 只保存追溯 ID。批量采纳用 store 的单次队列/CAS，不逐条提交。

`services/organization.js` 处理 tags/stage 默认值、校验与纯函数更新；更新不伪造 AI 来源。旧记录的新增字段仅读取时补默认，不进行批量数据迁移。

### 15.4 可选使用统计

`createUsageMetrics({storage,cacheScope,now})` 提供 `read/setEnabled/track/report`。默认关闭，`track(event)` 忽略未知事件与所有额外参数；统计写失败仅返回 false，业务成功仍由业务结果决定；查看或复制不发送给维护者。**2026-09-30 用户决定：客户端入口（原「使用帮助—诊断信息」）已删除**，服务与接线保留、默认关闭无界面；本节只描述服务本身。

### 15.5 照片接入与同步

`Repository.removePhoto(accountKey,{inspirationId,photoId,baseVersion,generation})` 与整条删除共用 `photoCleanup` 两阶段清理。`removeFiles(fileIds)` 必须逐文件检查 SDK 状态，不因调用返回而视为全部成功。任务登记、执行与最终 CAS 可重试；相关记录写入返回 `PHOTO_CLEANUP_PENDING`，其他记录仍按版本规则处理。源记录删除先撤销文字分享，失败关闭。

Store 新增 `deletePhoto(inspirationId,photoId)`，队列 `kind:'photoDelete'` 对应 `photo.delete`。已排删除的记录不再接受本地改写；客户端处理确认只移除对应照片，整条删除同时恢复指向该记录的来源。服务端拒绝跨账户文件引用与未经独立动作移除照片。

`createPhotoWorkflow({storage,cacheScope,store,prepare,upload,expectedFileId,saveFile,removeLocal,removeRemote,newId,now,isCurrent})` 提供 `list/add/retry/discard`；仅收纳准备成功的文件，所有状态按账户持久化。详情提供相册/拍照选择、预览、失败重试、明确放弃与单照片删除确认。页面离开与账户切换不回显迟到结果；基础文字保存不依赖照片任务成功。

上传前持久保存临时文件、固定对象路径与任务；上传请求前标记 attempted，避免响应丢失后产生无法追踪的对象。成功收到 fileId 后先保存任务再写记录，重试复用同一对象和 photoId。已加入记录的任务不允许作为未提交草稿直接放弃，须走照片删除动作。照片删除任务 ID 区分整条与单张操作，部分清理进度持久保存。

`server/record-validation.js` 导出 `validRecord(item)`，校验长度、时间、唯一 ID、历史结构、标签阶段、来源字段及补充合并引用无环。Repository 另外校验灵感合并图、历史内容只增不改和照片路径。`saveInspirations(items)` 以一次本机写入、一条最多 21 条的 upserts 队列和一次服务端 CAS 保存汇总批次。

会话草稿按可信账户 scope 分区保存在内存；后台先解绑旧账户，重新确认后恢复该账户的草稿。页面保存/生成结果须匹配开始时的 store 与 sessionEpoch，迟到结果不得更新新账户页面。进程结束仍不承诺保存未提交草稿。

Store 增加可选 `isCurrent()` 会话守卫：每次发送前及响应返回后核验，不允许旧实例继续发送剩余队列、确认迟到结果或采用远端版本；失效返回 `ACCOUNT_SESSION_CHANGED`，原队列保留。应用按初始化 epoch 注入该守卫。照片服务在每次上传或清理前也核验会话；相机/相册返回时若账户尚未重新确认，暂存任务保留，确认同账户后由新实例重试，不向新账户传送旧内容。

## 16. 跨灵感手动选材

`services/material-output.js` 导出 `MATERIAL_LIMITS`（parts=40、sources=20、chars=12000）、`listMaterials(items)`、`buildMaterialDraft(items,selections,templateId)`。素材 key 由灵感 ID 与正文/补充 ID 组成；返回白名单 `key/inspirationId/kind/content/sourceText/createdAt`，不携带照片、历史或身份。selections 保存 key 与选择时内容；生成按其顺序核对最新有效素材，再调用既有 `buildTemplateText`。任何失效、重复、超限、内容变化均抛用户可读错误，原素材不变。

列表“选材整理”进入 `pages/material-output`，允许正文与补充分别选择，按关键词查找或只看已选，显示顺序号及段数。五类模板沿用单条整理。生成结果只驻留页面内存，编辑后重新生成必须确认；刷新素材也需确认清空选择，但不覆盖已有稿件。生成时核对当前来源，不自动采用新文字。选材与稿件切换后回到页顶，不沿用长列表的滚动位置。

复制/另存均由用户触发。另存最多 2000 字，使用既有 `createInspiration` 与 `saveInspiration`，不新增来源或 AI 标记；同一稿件成功保存后禁止重复点击，编辑后可另存新版本。每个异步操作捕获页面代次、store 和账户 epoch，失效回调不得更新页面；页面隐藏立即清空私有数据，返回同页重新读取，提示未另存稿件不跨离开保留。不创建云资源、不调用模型。

## 17. 云端确认保存（`cloud-confirmed-saves`）

本节覆盖 §2.1、§3、§5、§13、§15.5 中关于设备持久快照、离线队列、自动重试、冲突恢复副本和照片持久暂存的旧约定。服务端协议、可信身份、版本 CAS 与照片云清理机制不变；客户端不再调用 `wx.setStorageSync` 或 `wx.saveFile` 保存业务内容。

`app.refreshAccount` 先拉取可信账户快照，再构造 `createCloudOnlyStore({transport,remoteSnapshot,cacheScope,now,isCurrent})`。正文、照片引用和版本只在当前会话内存里。回到前台先清空旧账户视图；云拉取失败时保持不可读，不从设备缓存回退。回顾设置与自愿使用统计改用会话内存适配器，进程重开会恢复默认设置，不会在设备留下统计。旧开发缓存不再扫描、读取或回放。

`saveInspiration/saveInspirations/deleteInspiration/deletePhoto` 串行发送带 `generation/baseVersion/requestId` 的请求。只在服务端有效成功响应后更新内存视图，返回 `{ok:true,synced:true}`；失败不改视图、不建立队列，页面保留输入。超时可能发生在服务端已写入之后，客户端先 `snapshot.pull` 核对目标内容；确认一致才报告成功，否则报告未确认，保留当前输入。会话内重试记录复用同一 ID；进程退出后未确认操作不会恢复，因此真实弱网下仍有不确定窗口，不能称跨进程恰好一次。用户可刷新列表核对，正式发布前需真机验证。

照片仅用 `chooseMedia/compressImage` 产生的微信临时路径调用云存储上传，不主动复制到持久文件。上传结果与预期私有路径一致后，调用云端记录写入；写入失败先拉取核对是否已经关联，确认未关联才尝试删云文件。核对失败时保守地留下可能的云文件供后台核查，不能盲删已关联照片。小程序主动生成的 TXT、海报和用户剪贴板属于用户触发的输出动作，不是记录持久来源；临时输出仍须按原设计清理。

照片服务只提供 `add(inspirationId, source)`，不提供暂存列表、重试或放弃接口。上传完成后重新读取当前记录再关联照片，避免覆盖上传期间的文字修改。已确认失败时提示重新选择未添加的照片，文字输入保持不变；关联状态无法核对时停止本批后续上传，提示重新打开灵感核对照片，不直接引导重复添加。页面离开或账户会话变化后，不将迟到结果写入新页面。

用户确认项目未上线、没有其他使用者，开发阶段数据均不保留，因此不开发旧缓存迁移或恢复流程。新入口不使用旧数据，也不因启动自动清空设备调试缓存；开发者可按需清理自己的测试环境。新流程的启用不代表设备调试缓存已被物理删除。

### 17.1 当前客户端存储接口

`miniprogram/services/cloud-only-store.js` 导出 `createCloudOnlyStore()`，创建后提供以下方法；这些方法是当前小程序的接口，§7.5 和 §7.7 是包外历史材料。

```js
readSnapshot()
getConfirmedRevision()
refresh()
saveInspiration()
saveInspirations()
deleteInspiration()
deletePhoto()
listInspirations()
getInspiration()
```

`getConfirmedRevision()` 只返回当前云端已确认的版本和代际，供创建文字分享使用。网络恢复时 `refresh()` 拉取可信账户快照；不提供离线操作队列、备份状态或恢复副本接口。
