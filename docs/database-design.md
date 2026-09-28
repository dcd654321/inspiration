# 数据库设计

微信云开发用的是 JSON 文档数据库（MongoDB 系）。这份文档写清楚三件事：**集合长什么样、哪些约束数据库能替我们守住、哪些只能靠代码守**。

第三件最重要。云开发的数据库**不校验字段类型、不校验长度、没有外键、不管引用完整性**——把这些当成「数据库会管」是这类项目最常见的跑偏方式。

> 范围（2026-09-28 核对）：§1—9 为账户数据及同步设计，§10 为分享反馈结构，§11—15 为配额、限流、AI、照片任务与自愿统计。共六个集合，字段与索引已与代码核对一致。
> **平台状态与文档描述是两件事**：六个集合已在 product 创建并回读为空（回读时各自只有平台自带的两个索引），但 15 个业务索引、集合权限、云函数部署与云存储规则均未完成，云端验收一律未取得证据。热度提炼暂缓，`heat` 当前不写入。


## 1. 选型带来的三个硬事实

| 事实 | 对设计的影响 |
| --- | --- |
| **单文档写入是原子的** | 这就是「一个账户一份文档」这个形态的真正理由——一次保存改一条灵感，要么全成要么全不成，不需要事务 |
| **跨文档不能默认视为原子**（云函数事务能力也需按部署环境核实） | 核心灵感及补充继续内嵌；§10 的分享与反馈因授权和生命周期不同而单独建集合，并显式设计失败关闭与补偿 |
| **单文档有大小上限**（MongoDB 限制 16MB） | 见 §5 容量估算。这条会在本机存储上限之后才碰到，但不是永远不会碰到 |

## 2. 集合清单

共六个集合，全部使用 `linggan_` 前缀。**「已创建」只表示集合在 product 环境里存在且为空，不表示索引与权限规则已配好，也不表示函数已部署。**

| 集合名 | 用途 | 文档粒度 | 字段与索引 | 平台状态（2026-09-28） |
| --- | --- | --- | --- | --- |
| `linggan_accounts` | 全部业务数据 | 一个微信账户一份 | §3、§4.1 | 已创建，`accountKey` 唯一索引创建待确认 |
| `linggan_shares` | 用户主动创建的受控文字分享快照 | 一次分享一份 | §10.1、§10.3 | 已创建，索引与权限未配 |
| `linggan_feedback` | 意见反馈与内容举报 | 一次提交一份 | §10.2、§10.3 | 已创建，索引与权限未配 |
| `linggan_usage` | 分享与反馈的事务配额 | 一个账户一份 | §11 | 已创建，无需业务索引 |
| `linggan_rate_limits` | 接口分钟级限流计数 | 一个窗口一份 | §11 | 已创建，索引与权限未配 |
| `linggan_ai_usage` | AI 日额度、频率与请求幂等 | 一个账户一日一份 | §13 | 已创建，索引与权限未配 |

**账户核心仍只用一个集合，是刻意的。** 灵感正文、补充、图片记录仍内嵌在同一份账户文档里，因为它们总是一起读写。分享与反馈不是灵感子文档：分享允许持凭证者跨账户只读，反馈有独立的状态与保留周期，所以另建集合，不能据此把私人照片或完整历史外移。配额、限流与 AI 用量同理——它们要跨实例原子递增，且生命周期与账户快照完全不同。

## 3. `linggan_accounts` 文档结构

### 3.1 账户级字段

| 字段 | 类型 | 谁写入 | 说明 |
| --- | --- | --- | --- |
| `_id` | ObjectId | 数据库 | 自动生成，业务不使用 |
| `accountKey` | string | 服务端 | **由可信上下文推导，绝不接受客户端传入**。见 §4 权限规则 |
| `generation` | number | 服务端 | 数据代际。仅在用户主动清空或代际变更时递增；正常删除单条灵感**不**递增 |
| `version` | number | 服务端 | 账户级版本号，每次成功写入递增，用于冲突判定 |
| `updatedAt` | number | 服务端 | 服务端时间戳（毫秒） |
| `inspirations` | array | 客户端提交、服务端校验 | 灵感数组，见 3.2 |
| `photoCleanup` | array | 服务端 | 待清理任务；旧账户缺省 []，与记录同一 CAS 写入 |

### 3.2 `inspirations[]` 元素

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | `^[A-Za-z0-9_]{1,64}$` | 客户端生成。**字符集收窄是安全要求**——它会参与云存储路径拼接 |
| `text` | string | 是 | 非空白，≤ 2000 字符 | 当前原文，可直接改写 |
| `textHistory` | array | 是 | 可空数组 | 历次被替换的原文，见 3.3 |
| `createdAt` | number | 是 | 非负整数 | 毫秒时间戳 |
| `updatedAt` | number | 是 | 非负整数 | 列表按它倒序 |
| `supplements` | array | 是 | 可空数组 | 见 3.4 |
| `photos` | array | 是 | 可空数组 | 见 3.5 |
| `tags` | string[] | 是 | 最多 5 个，单个 12 字，不重复 | 旧记录缺省为空 |
| `stage` | string | 是 | `seed` / `growing` / `ready` | 想法 / 整理中 / 可使用；旧记录缺省 seed |
| `source` | string | 是 | `user` / `ai` | 当前正文的来源，AI 后续编辑仍保留标记 |
| `summarySources` | string[] | 是 | 最多 20 个来源 id | 汇总追溯，不复制正文；来源删除后显示已删除 |
| `mergedInto` | string \| null | 是 | 灵感的 `id`，不得指向自身 | 被 AI 汇总进哪一条 |
| `deletedAt` | number \| null | 是 | | 软删标记，云端确认后才物理移除 |
| `heat` | object | 否 | **本变更不写入** | 热度已暂缓，字段名保留以避免后续迁移 |

### 3.3 `textHistory[]` 元素

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 客户端生成，用于幂等与去重 |
| `text` | string | 被替换掉的原文内容 |
| `replacedAt` | number | 被替换的时刻 |

**只增不减。** 服务端必须校验这一点（违反返回 `HISTORY_TRUNCATED`）——这是产品承诺「你说过的话不会被悄悄抹掉」在服务端唯一的落点。数据库不管这件事，只能靠 `server/` 里的比较逻辑。

### 3.4 `supplements[]` 元素

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 同上，幂等键 |
| `content` | string | 普通补充 ≤ 1000 字符，AI 汇总补充 ≤ 2000 字符；编辑沿用对应上限 |
| `contentHistory` | array | 这条补充自己的历史，结构同 3.3 |
| `createdAt` | number | 记录时间 |
| `source` | string | `'user'` 或 `'ai'`。AI 产出**必须**标为 `'ai'`，界面据此标注 |
| `sourceIds` | string[] | 汇总来源补充 id，普通补充为空；旧记录缺省为空 |
| `mergedInto` | string \| null | 被 AI 汇总时指向汇总结果的 `id` |
| `foldedAt` | number \| null | 被**并入正文**的时刻（界面动作名「并入正文」，收起行显示「已并入灵感」） |

`mergedInto` 与 `foldedAt` 是两种不同的「收起」：前者并进汇总结果，后者并进原文。**两者可以同时为 null，但不应同时非 null。**

### 3.5 `photos[]` 元素

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 幂等键，同时是云存储的对象名 |
| `fileId` | string | 云存储 fileID |
| `createdAt` | number | |

**只有上传成功的照片才进入这个数组。** 上传中、上传失败属于本机临时状态，不落云端——这样云端不存在「半张照片」，也就不会有半成品被同步到另一台设备。

## 4. 索引与权限规则

### 4.1 索引

| 索引 | 字段 | 类型 | 理由 |
| --- | --- | --- | --- |
| `accountKey` 唯一索引 | `accountKey` | unique | **一份文档一个账户**这条约束，数据库能替我们守住，就一定让它守。靠代码去「先查再插」在并发下会插出两份 |

对 `linggan_accounts`，除此之外不需要别的索引：查询只有 `where({ accountKey })` 一种形态，而灵感列表是在**文档内部**排序的。§10 的新集合另有自己的索引。

全库共 15 个业务索引（含 5 个唯一索引），逐条定义见 `deployment/product/indexes/`，与 `deployment/product/README.md` 的计数一致。**平台状态（2026-09-28）**：`accountKey` 唯一索引的创建已发起、正在开发者工具内等待确认，**不能计作成功**；其余索引尚未提交。索引文件只含 `CreateIndexes`，不含 `DropIndexes`、TTL 或数据删除。

### 4.2 权限规则

**选「所有用户不可读写」**——客户端不能直接访问这个集合，只有云函数以管理员权限操作。

理由不是「更安全一点」，而是**这个功能依赖身份只能来自可信上下文**：

- 云开发数据库的预设权限规则里，客户端的身份来自它自己声明的 `_openid`。客户端能构造这个字段。
- 规范要求「客户端提供的身份字段不得授予访问权」。
- 只要允许客户端直连数据库，这条要求就只能靠「希望客户端不作弊」来满足。

因此：**客户端一律经 `linggan_api` 云函数读写**，云函数从 `cloud.getWXContext()` 取身份。代价是每一次读写都要过一次云函数调用，收益是身份不可能被伪造。

### 4.3 云存储

共享环境部署补充（本地实现、平台待验收）：账户标识只接受本项目的可信来源 AppID/OpenID；跨账号调用使用完整的 FROM_APPID/FROM_OPENID，不以资源方身份替代。哈希结构不变，无云数据库字段迁移。客户端缓存按资源方 AppID 和环境 ID 增加外层命名空间，旧缓存保留但不自动重放到 product。集合均要求禁止客户端直读写；共用 cloudbase_auth、其他集合和全局存储规则不得随本项目部署改写。

| 项 | 值 |
| --- | --- |
| 路径 | `linggan/{accountKey}/{inspirationId}/{photoId}` |
| 权限 | 仅创建者可读写 |
| 对象名前缀 | `linggan/`，用于辨识本项目资源 |

`accountKey` 参与路径，使越权拼接路径也无法命中他人对象，但**访问控制仍依赖云存储权限规则——路径命名是第二道，不是第一道**。

对象名用 `photoId` 而非随机名：重传覆盖同一对象，上传重试不会产生重复文件。

## 5. 容量估算

先算清楚**谁先撞墙**，否则优化会花错地方。

| 维度 | 上限 | 估算 | 谁先撞 |
| --- | --- | --- | --- |
| 云开发单文档 | 16MB | 一条灵感平均约 1.5KB（正文 + 若干补充 + 图片记录），**约 1 万条** | 第三 |
| 本机键值存储 | 10MB | 同样按 1.5KB 算，**约 6000 条** | **第一** |
| 本机文件系统 | 200MB | 照片压缩后按 300KB 算，**约 600 张** | 第二 |

**本机键值存储会最先撞上限**——10MB，约 6000 条。所以：

- `detailed-design.md` §3.2 定了「快照超过 1MB 时改为索引 + 单条明细两层」。1MB 约合 600 条，是在撞墙之前很早就动手。
- 云端的 16MB 单文档上限在这个产品的量级下**碰不到**，不需要为它做分片。但要知道它存在——真到了那天，改的是「一个账户一份文档」这个根本形态。

## 6. 事务与原子性边界

| 操作 | 是否原子 | 说明 |
| --- | --- | --- |
| 单条灵感的增删改 | 是 | 同一条文档内，一次 `update` 完成 |
| 删除灵感 + 清理云存储文件 | **否** | 云文件可能部分删除，不能物理回滚。两阶段清理已实现：先按版本 CAS 登记 `photoCleanup` 任务、逐文件确认 SDK 状态、全部成功后重新 CAS 收敛；失败返回 `PHOTO_CLEANUP_PENDING` 并保留任务重试。见 §14 与 `detailed-design.md` §15.5。**这套协议尚未在真实云存储上执行过** |
| 多个账户之间 | 不适用 | 账户之间没有任何共享数据 |
| 私有灵感与分享快照 | **否** | 见 §10.4；分享读取时复核来源仍有效，源记录删除确认后不再对新读取开放 |

## 7. 数据库**不**替我们守的约束（重要）

以下全部要靠 `core/` 的校验、`server/` 的仓库层或服务端比较逻辑实现。**把它们当数据库的事，就是跑偏的开始。**

| 约束 | 为什么数据库不管 | 靠谁守 |
| --- | --- | --- |
| 字段类型与必填 | 文档数据库无 schema | `core/inspiration.js` 校验 + 服务端复核 |
| 正文 / 补充 / 历史的长度上限 | 无长度约束 | `core/limits.js` + `core/inspiration.js` |
| `id` 的字符集（防路径拼接） | 无格式约束 | `core/inspiration.js` 的 `ID_PATTERN` |
| **`textHistory` 只增不减** | 无变更审计 | 服务端比较新旧 `textHistory`，违反返回 `HISTORY_TRUNCATED` |
| `mergedInto` 不成环、不指向自身 | 无引用完整性 | `core/inspiration.js` 校验 + 服务端复核 |
| 删除汇总结果时恢复指向它的补充 | 无级联 | `core/inspiration.js` 的 `removeSupplement` |
| 同一账户内 `id` 不重复 | 数组内无唯一性 | 服务端按 `id` upsert |
| `source` 只能是 `user` / `ai` | 无枚举约束 | `core/inspiration.js` |

## 8. 演进

- **新增字段**：本机的快照读取对缺失字段一律给默认值（`textHistory`、`mergedInto`、`foldedAt` 都做了）——旧数据在升级后不会读崩。
- **改布局**：本机键带版本号与环境段（`linggan:env:<资源方AppID>:<环境ID>:linggan:v2:<cacheScope>:state`），按可信账户作用域分区，见 §9。云端若必须改形态，靠 `generation` 递增让旧设备的离线队列失效，而不是原地迁移数据。
- **不做的迁移**：用户既有的备忘录、聊天记录、历史截图不在任何迁移范围内，只能手动重新记录。

## 9. 云同步整改的写入约束（`repair-cloud-sync`）

`version` 是账户级乐观锁。`snapshot.push` 与 `inspiration.delete` 都必须携带有效 `generation` 和 `baseVersion`；缺失即拒绝，不能因旧客户端省略字段而绕开校验。服务端读取账户文档后，最终写入也必须按 `accountKey + 旧 version` 条件更新，并检查实际更新数；单纯「先读版本、再无条件 put」仍会在并发下丢更新。新账户首次插入依靠 `accountKey` 唯一索引挡住并发重复创建。上线前须核对索引实际存在并评估旧客户端兼容。

客户端新缓存使用可信云函数返回的不透明 `cacheScope` 分区；它只决定本机键名，不能随请求发给服务端当身份。旧 `linggan:v1:*` 全局键在归属未知时保持原样，不自动挂给当前账户，不执行删除或覆盖。用户真实数据迁移需要单独确认与回滚证据。

本机 `linggan:v2:<cacheScope>:state` 的恢复字段为 `recoveries[]`；每项包含 `savedAt`、`reason`、`snapshot`（冲突时本机快照）和 `pendingOps`（未确认操作）。它与活动快照、队列在单键中原子写入，绝不上传到云端。采用云端版本时先追加恢复副本，写入成功后才能清空活动队列；普通启动拉取必须保留该数组。若因容量不足无法写入恢复副本，保持冲突状态，不执行切换。

## 10. 分享与反馈新增集合（`add-sharing-feedback`，已实现、云端待验收）

本节字段及服务端代码已落在本地工程，**当前云端不一定存在集合、索引或权限规则**。清理任务已有本地实现，未部署或运行。不得仅因文档与代码落地就认为分享可用。新集合均使用 `linggan_` 前缀，不修改其他小程序集合或共用认证设置。新集合不改变 `linggan_accounts` 的字段清单；§3 的结构校验仍只针对现有账户文档。

### 10.1 `linggan_shares` 字段

| 字段 | 类型/约束 | 写入者 | 用途及读取边界 |
| --- | --- | --- | --- |
| `_id` | string，服务端生成时间前缀 + 随机后缀 | 分享服务 | 内部分享 ID 与分页游标；可给所有者管理页，不是访问凭证 |
| `ownerAccountKey` | string，非空 | 分享服务 | 仅从可信微信上下文推导；客户端不可传 |
| `sourceInspirationId` | string，匹配既有 `id` 格式 | 分享服务 | 来源定位，仅服务端/所有者管理使用 |
| `sourceGeneration` | number，正整数 | 分享服务 | 创建时账户代际；账户清空或代际变化后分享失效 |
| `sourceVersion` | number，非负整数 | 分享服务 | 创建时的账户版本，用于审计快照一致性，不要求后续版本相等 |
| `selectedSupplementIds` | string[]，去重 | 分享服务 | 创建时用户确认的有效补充 ID；公开读取不返回 |
| `snapshot` | `{ title: string, body: string }` \| null；创建时必填，清理后为 null；聊天文字合计 ≤6000 字，朋友圈海报 ≤1800 字 | 分享服务/清理任务 | 冻结的**纯文字**；不含照片、`fileId`、修改历史、账户身份及其他记录 |
| `snapshotDigest` | string，SHA-256 摘要 | 分享服务 | 检测快照意外改变；不作身份或访问控制 |
| `channelIntent` | `chat` / `timeline_poster` | 分享服务 | 仅用户当时选择的分享方式，不代表微信发送/发布成功 |
| `tokenHash` | string，SHA-256 十六进制 | 分享服务 | 按持有令牌定位记录；唯一索引，公开响应不返回 |
| `tokenCiphertext` | `{ keyId, iv, tag, data }` \| null，AES-256-GCM；清理后为 null | 分享服务/清理任务 | 仅同一所有者、同 `requestId` 创建重试时解密返回；不用于列表或日志 |
| `requestId` | string，稳定幂等 ID | 分享服务 | 与所有者组成唯一键，重试不产生另一条可用分享 |
| `requestDigest` | string，参数规范化摘要 | 分享服务 | 同 ID 不同参数必须拒绝，不误返旧分享 |
| `createdAt` | number，服务端毫秒时间 | 分享服务 | 排序与展示 |
| `expiresAt` | number，`createdAt` + 30 天 | 分享服务 | 到期后拒绝读取，客户端时间不能延长 |
| `revokedAt` | number \| null | 分享服务 | 撤销时间；非 null 即拒绝读取 |
| `payloadPurgedAt` | number \| null | 清理任务 | 过期/撤销后清除 `snapshot` 与 `tokenCiphertext` 的记录时间 |

令牌由云函数使用密码学安全随机源生成 28 位大小写字母数字串；客户端 URL/海报码可以携带**明文令牌**，但数据库只按 `tokenHash` 查找，服务端日志不记录它。`tokenCiphertext` 需要云函数侧版本化密钥；密钥不能写在小程序包、仓库或数据库。数据库泄露时哈希不能直接用作访问凭证；密钥丢失时旧链接仍可按哈希读取，但同请求返回原令牌会失败，必须提示用户重新创建，不能假报幂等成功。密钥轮换须保留旧 `keyId` 的解密能力直至相关幂等重试窗口结束。

`snapshot.title` 由正文首行生成且去空白，最多 50 字；`snapshot.body` 是实际展示的全部正文与选中补充，不包含未选项。公开 `share.get` 返回白名单 `{ title, body, createdAt, expiresAt }`，绝不透出此表的其余字段。`myShares.list` 返回 `_id`、来源灵感 ID、时间、渠道意图及计算后的状态；快照尚在时可给标题/短摘要，清理后只显示“内容已清理”。来源 ID 仅给所有者，用于重新预览并创建新分享。列表不返回令牌、哈希、密文、来源账户键，也不“复活”旧令牌。

### 10.2 `linggan_feedback` 字段

| 字段 | 类型/约束 | 写入者 | 用途及读取边界 |
| --- | --- | --- | --- |
| `_id` | string，服务端生成时间前缀 + 随机后缀 | 反馈服务 | 反馈主键与本人列表游标，不由客户端指定 |
| `accountKey` | string，非空 | 反馈服务 | 仅从可信微信上下文取得，公开不返回 |
| `requestId` | string，稳定幂等 ID | 反馈服务 | 与账户组成唯一键，重复提交不造多条 |
| `requestDigest` | string，参数摘要 | 反馈服务 | 同请求 ID 不同内容时拒绝 |
| `dedupeKey` | string，服务端生成 | 反馈服务 | 举报用账户、分享、自然日摘要去重；普通反馈用独立随机键 |
| `category` | `bug` / `idea` / `other` / `share_report` | 反馈服务 | 用户选择，举报只由分享页动作设置 |
| `body` | string，去首尾空白后 10—1000 字 | 反馈服务 | 用户意见；按个人内容保护，不公开 |
| `relatedShareId` | string \| null | 反馈服务 | 举报时由有效令牌解析，普通反馈为 null；客户端不可直接指定 |
| `reportDayKey` | string \| null，`YYYY-MM-DD` | 反馈服务 | 同账户同分享每日举报去重，不含原令牌 |
| `status` | `submitted` / `reviewing` / `closed` | 反馈服务；后两态仅受权后台 | 本人可见的处理状态，不意味着承诺回复时间 |
| `createdAt` | number，服务端毫秒时间 | 反馈服务 | 本人列表与后台排序 |
| `updatedAt` | number，服务端毫秒时间 | 反馈服务/受权后台 | 状态更新时间 |
| `closedAt` | number \| null | 受权后台 | 清理时点基准 |

首版不存照片、文件、设备指纹、联系方式专栏或后台回复。用户自愿写进正文的敏感信息仍属于个人数据，界面提醒勿填写。举报记录只存分享内部 ID，不复制被举报的全文或令牌；后台若需审阅，必须走受权接口并受分享失效边界约束。`feedback.listMine` 仅返回本人类别、正文、时间与状态，不返回举报对象的所有者信息或任何管理字段。

### 10.3 索引、权限与容量

| 集合 | 索引 | 类型/作用 |
| --- | --- | --- |
| `linggan_shares` | `tokenHash` | unique；令牌只读定位 |
| `linggan_shares` | `(ownerAccountKey, requestId)` | unique；跨实例创建幂等 |
| `linggan_shares` | `(ownerAccountKey, _id desc)` | 本人稳定游标列表，`_id` 含时间前缀 |
| `linggan_shares` | `(ownerAccountKey, sourceInspirationId, revokedAt)` | 源删除时找出待撤销分享 |
| `linggan_feedback` | `(accountKey, requestId)` | unique；提交幂等 |
| `linggan_feedback` | `dedupeKey` | unique；跨实例举报去重 |
| `linggan_feedback` | `(accountKey, _id desc)` | 本人稳定游标列表 |
| `linggan_feedback` | `(status, createdAt desc)` | 受权后台处理队列，首版不暴露客户端 |

举报同一分享/账户/自然日的 `dedupeKey` 由服务端对 `(accountKey, relatedShareId, reportDayKey)` 的规范串作 SHA-256；普通反馈使用独立随机键。唯一索引防跨实例重复举报，`_id` 均保持时间前缀以便分页。每日反馈 5 条、每日分享创建 10 条、同时有效分享 20 条，以及 `share.get` 读限流，都由服务端计数与风控守；单靠“先查数量再插入”不能在并发下保证绝对上限，实施时需事务/条件计数或接受明确的软限并测试。验收前不得宣称限额严格原子。

三个集合均设客户端**直接不可读写**；仅服务端用平台可信身份访问。`linggan_api` 的 `share.get` 在完整小程序登录上下文中允许持有效令牌的非所有者只读，但不得放开 `linggan_accounts` 或通用查询；其余分享与反馈动作需可信账户。不能靠客户端传 `accountKey`、OpenID 或 AppID 决定权限。朋友圈单页模式没有 OpenID，首版内容海报在朋友圈本身展示文字、扫码后进入完整小程序查看；原生内容卡片如需匿名读，必须先设计独立最小权限的读取资源并获共享环境变更授权，不得为此把现有环境/函数改成匿名全读。

按最多 6000 字正文估算，一条分享快照约 12KB 中文 UTF-8 上界可达约 18KB，加元数据仍远低于单文档上限；20 条有效分享约数百 KB/账户。朋友圈海报最多 1800 字、9 页，超限拒绝生成而不截断。实际容量、索引费用和并发吞吐须受控云端测量，不用这个估算代替配额验证。反馈正文最多 1000 字，独立文档避免撑大账户快照。

### 10.4 生命周期、清理与失败关闭

1. `share.create` 先从服务端已确认账户版本生成快照，经公开内容安全检查后写入新文档；写入成功才把令牌交给客户端。写入失败不返回可用令牌。同 `requestId` 重试须比对 `requestDigest` 后返回原分享；不同参数拒绝。
2. `share.get` 每次按令牌哈希查记录，检查 `expiresAt`、`revokedAt`、`payloadPurgedAt`，再查来源账户 `generation` 和灵感仍存在且未删除；任何查询失败都返回统一不可查看状态，不用旧缓存。**源删除确认后的新读取**不能再取得快照。已在途的读取和已外发的海报/截图无法回收，界面不得承诺绝对撤回。
3. 撤销写入 `revokedAt` 后新读取失效。删除来源时先尽力撤销其分享，再走原删除协议；即使跨集合操作部分失败，来源复核仍应在源删除后拒绝。账户清空使代际变化，旧分享即失效。云端恢复/回滚不得重新启用已撤销令牌。
4. 过期或撤销满 90 天后，受控清理任务删除 `snapshot` 与 `tokenCiphertext`，保留 `_id`、所有者、时间、渠道意图及状态元数据供“我的分享”回看；账户删除时按经授权的数据删除流程清掉本人分享和反馈。不能对 `expiresAt` 直接建 TTL 索引，否则过期记录从“我的分享”消失，违背管理需求。清理任务未部署前须声明个人内容仍保留，不得写成自动清理已生效。
5. 反馈保留方案：关闭后 180 天或仍未关闭但创建满 365 天，受控任务删除正文及记录；页面展示可回看的时间范围。清理代码已实现且默认演练，未部署执行，正式启用前核对隐私告知和删除证据。

朋友圈海报存入用户相册及其自行发布的朋友圈，**不属于上述云数据库清理范围**；撤销只能让海报码所指分享页失效，不能删除图片上已展示的文字。任何生成的临时图片在小程序本机缓存中按会话清理，不上传用户照片；分享封面和海报只由已确认的文字快照绘制。

## 11. 原子配额与访问计数（`complete-product-workflows`）

`linggan_usage` 每账户一文档，`_id=SHA256(accountKey)`，客户端全拒绝。字段：`accountKey:string`、`dayStart:number`（UTC+8 自然日）、`shareCount:number`、`feedbackCount:number`、`activeShares:Array<{shareId:string,expiresAt:number}>`、`updatedAt:number`。配额文档与新增业务记录在同一 `runTransaction` 中写入；超限抛错回滚。每日上限为分享 10、反馈 5，有效分享最多 20；撤销与删除分享占位在同一事务处理。过期占位在下次写时剔除。当日重试与去重由原有唯一索引保证，失败事务不占额。

首次初始化从现有分享/反馈读取当日计数和有效分享引用；上线前必须停止旧版绕过配额的写入实例，再初始化/启用新版。不把这一过程称为自动完成的迁移。活跃引用若已有超限记录，保守阻止新建，不删数据。

`linggan_rate_limits` 以 `SHA256(accountKey + action + windowStart)` 为 `_id`。字段：`action:string`、`windowStart:number`、`used:number`、`expiresAt:number`。初始化后通过 `_id + used < limit` 条件原子递增，成功更新一条才放行；无身份、初始化失败或更新异常均失败关闭。窗口均为 60 秒：创建分享 20、读取分享 60、生成码 5、本人分享列表/撤销 30、反馈提交/举报 10、反馈列表 30。计数文档窗口结束 24 小时后可清理，索引 `expiresAt`。

清理索引：`linggan_shares.(payloadPurgedAt,expiresAt,_id)`、`(payloadPurgedAt,revokedAt,_id)`；`linggan_feedback.(status,closedAt,_id)`、`(status,createdAt,_id)`。清理候选分过期/撤销/关闭/未关闭扫描，最多每类 100 条，避免全表读取。提交清理时再按 `_id` 和期限/状态匹配；分享只置空 `snapshot/tokenCiphertext` 并写 `payloadPurgedAt`，反馈条件删除。失败记录保留下轮重试。

## 12. 本机回顾偏好

键 `linggan:v2:<cacheScope>:review`，只有取得可信快照后才创建服务。字段 `enabled:boolean`（默认 true）、`dayKey:string`（UTC+8 日期）、`selectedId:string|null`、`dismissed:boolean`。不含正文、照片、搜索词或账户原始标识；不进入云端灵感快照。损坏时仅重置偏好，不改用户记录。设置写入失败向页面返回异常，不把失败写入算作关闭成功。

## 13. AI 配额与请求凭证

`linggan_ai_usage`：`_id=SHA256(accountKey|dayStart)`；`dayStart:number`、`used:number`、`minuteStart:number`、`minuteUsed:number`、`requests:Record<requestHash,{status:'pending'|'done'|'failed',fingerprint:string}>`、`expiresAt:number`。账户原始身份、提示词和生成内容均不落库；仅受信云函数可读写。每日最多 100 次尝试（含失败），防止退款重试撑大文档。预留及终态/退款用事务串行化；重复请求返回 `AI_REQUEST_REPLAY`，不同输入复用返回 `REQUEST_ID_REUSED`，不重发模型。7 天到期，可由授权维护任务条件清理，索引 expiresAt。

Store 队列新增 `kind:'batch'`、`inspirations:Inspiration[]`；快照和整批队列在同次本机写入，服务端只接受一次 CAS。旧 `upsert/delete` 队列保持兼容。合并必须校验目标存在、非删除、无自指或环；删除目标时恢复引用它的来源。服务端不接受缩短或改写已有历史内容。

## 14. 照片闭环

`snapshot.pull` 的 `storagePrefix` 为已核验环境的 `cloud://环境.桶/` 前缀；客户端用于在上传前确定准确 fileID，避免上传响应丢失后无法定位孤立文件。照片暂存另记 `attempted:boolean`；先落该状态再上传，放弃时只清理固定对象，不重新上传。

账户 `photoCleanup[]` 字段：`id:string`（删除对象类型+id）、`inspirationId:string`、`photoId:string|null`（null 删除整条）、`fileIds:string[]`、`removedIds:string[]`（已确认清理进度）、`requestedAt:number`。首次删除先按版本 CAS 写任务，原记录保留且该记录暂停改写；此后同一删除动作可不依赖旧 baseVersion 继续清理。文件成功删除或 SDK 明确返回已不存在才完成；失败返回 `PHOTO_CLEANUP_PENDING`，任务和记录保留。进度写入失败可重复删除同一文件；未知 SDK 状态不视作成功。所有文件处理成功后重新读取账户、CAS 清任务及记录/照片；绝不声称已删除的文件可回滚。`photoCleanup` 不接受客户端回传。

`snapshot.pull` 增加 `photosEnabled:boolean` 能力，不是持久字段。只有服务端 `LINGGAN_PHOTOS_ENABLED=true` 且环境文件前缀配置有效时可新增照片/删除含照片记录；启用须先核验仅创建者读写存储规则。上传文件 ID 必须精确匹配当前环境前缀+`linggan/<可信accountKey>/<inspirationId>/<photoId>`，不得引用别的账户、记录、环境或任意 URL；缺失配置失败关闭。照片移除只走 `photo.delete`，不得通过推送静默丢弃文件引用。

本机键 `linggan:v2:<scope>:photo-drafts`：数组元素 `id/inspirationId/localPath/fileId/state`，state 为 prepared/uploaded/discarding；只在当前可信账户作用域读取。先持久化本机文件和任务，再上传固定路径；上传成功先存 fileId，后保存照片记录，失败可重试。用户明确放弃时先清已上传文件、再删除本机文件及任务；任一步失败保留任务。备份确认前不删本机文件。照片冲突恢复保留完整引用和本机任务，并提供恢复副本照片预览，不将图片写入文字导出或分享。

## 15. 自愿本机统计

跨灵感手动选材（`add-material-output`）不新增集合、持久字段或本机键。素材选择和未保存稿件仅在页面内存；另存生成标准 user 来源记录，`summarySources` 保持空数组，不将手动组合冒充 AI 汇总。复制不会写入数据库。

键 `linggan:v2:<scope>:usage`，字段 `enabled:boolean` 默认 false、`days:Record<YYYY-MM-DD,Record<event,count>>`；仅当前设备近三十个 UTC+8 自然日。事件白名单 `record_saved/supplement_saved/output_copied/output_saved/search_opened/review_opened/save_failed/backup_pending`。事件无附带属性，不存内容/id/时间点/搜索词/标签名/模型结果，不自动上传、不跨设备合计。每计数上限 100000；关闭以一次写入清空。导出只含日期和聚合计数，不含存储键/账户哈希。此数据不等于真实发表、全量留存率或全账户统计。
