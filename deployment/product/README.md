# product 资源创建清单

目标环境：`product-d2g59zty74d7d1ec1`；资源方：`wx7ad85943fe81e095`；调用方：`wxed8fdc5d559d973d`。本目录是部署输入，不包含已部署状态或真实凭据，不会随小程序和云函数目录上传。

## 数据库

| 集合 | 用途 | 新增索引数 | 其中唯一索引 |
| --- | --- | ---: | ---: |
| linggan_accounts | 账户快照、灵感、补充和同步版本 | 1 | 1 |
| linggan_shares | 分享快照、有效期、撤销及本人分享记录 | 6 | 2 |
| linggan_feedback | 意见反馈和内容举报 | 6 | 2 |
| linggan_usage | 分享与反馈事务配额 | 0 | 0 |
| linggan_rate_limits | 接口分钟级限流 | 1 | 0 |
| linggan_ai_usage | AI 日额度、频率和请求幂等 | 1 | 0 |

共 6 个集合、15 个业务索引（含 5 个唯一索引），不计平台自带索引。字段及索引依据 `docs/database-design.md` §4、§10、§11、§13。`linggan_usage` 按确定性 `_id` 访问，无需额外业务索引。所有集合必须设为客户端直接不可读写；不导入测试记录或占位账户。

`indexes/*.json` 仅有 CreateIndexes，未包含 DropIndexes、TTL 或数据删除。JSON 形状依据[腾讯云 UpdateTable 官方文档](https://cloud.tencent.com/document/product/876/127964)，实际工具结果与回读才构成创建证据。

用户已明确不采用 CloudBase CLI。当前微信开发者工具的受支持接口按单集合、单函数写入，且每笔需平台确认；未发现一次性创建全部资源并免逐笔确认的入口。这里保留精确清单供后续受支持的部署通道使用，不通过读取本机登录凭据、隐藏接口或跳过确认来执行。

## 执行顺序

1. 恢复 `openspec/changes/deploy-product-release/tasks.md` 中已有待确认任务，不能直接重发。
2. 用资源方身份读取集合列表。只补缺失的本项目集合；不读取其他应用的业务文档。
3. 回读各集合已有索引，按字段顺序、方向、唯一属性判断是否已存在，不能只看名称。仅提交缺失索引；同名异构或唯一冲突均停止，不删数据或原索引。
4. 六个集合的客户端全拒绝规则、15 个业务索引全部核验后，才进入业务函数部署及合成数据测试。
5. 核验生成副本与源码一致、运行三类本地检查、记录上传目录代码摘要。逐个部署本项目三个函数；回读状态并核验平台配置。
6. 受控账户业务测试、双账户隔离、真实编译、真机、客户端上传及公开发布分别留证。

单个集合的创建命令示例（仅在确认不存在且没有同一操作的 pending 任务后使用）：

```powershell
wechatide.cmd -c codex cloud_db_write_struct --appid wx7ad85943fe81e095 --env product-d2g59zty74d7d1ec1 --action createCollection --collection-name linggan_feedback
```

索引文件只适用于对应索引全部缺失的新集合；部分索引已存在时，先另备仅含缺失项的输入。示例：

```powershell
wechatide.cmd -c codex cloud_db_write_struct --appid wx7ad85943fe81e095 --env product-d2g59zty74d7d1ec1 --action updateCollection --collection-name linggan_accounts --update-options-file D:\codex\coding\inspiration-miniprogram\deployment\product\indexes\linggan_accounts.json
```

每笔云写遇到 `pending` 都暂停当前云端步骤，保留任务 ID，等开发者工具确认；不会用脚本自动批准或排队重复写入。

## 云函数与平台配置

`manifest.json` 为人工及后续工具读取的清单，不是微信开发者工具可直接整体导入的配置。函数目录相对于仓库根；部署须转成绝对路径、逐个调用 `cloud_fn_deploy` 并使用远端安装依赖。

| 函数 | 用途 | 部署条件 |
| --- | --- | --- |
| linggan_api | 记录同步、分享、反馈与照片生命周期 | 数据库规则及索引、可信来源、审核和小程序码权限 |
| linggan_ai | AI 扩展/整理、内容校验与额度 | 2026-10-02 已获启用授权；按 AI 启用计划核验模型、额度、审核、至少 60 秒超时后配置并部署 |
| linggan_maintenance | 有条件的过期内容清理 | 无定时触发器，保持关闭，本次不执行清理 |

非敏感目标环境变量在 manifest 中列出，**本地存在这些值不代表平台已配置**。`config.json` 中 OpenAPI 声明也不代替平台授权验证。

凭据只在支持的安全平台配置通道中生成和设置：

- `LINGGAN_SHARE_TOKEN_KEY`：32 字节密码学随机值编码为 64 位十六进制；不打印、不提交、不写客户端。`LINGGAN_SHARE_KEY_ID=v1`。
- `LINGGAN_MAINTENANCE_TOKEN`：至少 32 字符的随机值，同样不得写日志或仓库。无触发器且 `LINGGAN_MAINTENANCE_ENABLED=false`。
- 旧分享密钥轮换映射仅在已有旧密钥需兼容时设置，不在新环境填假值。
- 照片保持关闭。`LINGGAN_STORAGE_PREFIX` 只能由目标桶的真实 fileID 核实，不能猜；私有读写/删除和双账户测试通过后再启用。
- AI 已获启用授权，客户端入口已开。`manifest.json` 保留远端关闭的部署基线；启用增量与实测缺口见 `../ai-enablement-20261002.json`。模型 ID 取自目标环境实际已开通列表；本轮模型调用返回 `AI_DISABLED`，未成功推理。

当前 wechatide 0.3.9 注册的云管理命令未提供集合安全规则、函数环境变量和超时配置入口；不能用索引写入接口代替，不能改用隐藏接口或读取本机登录凭据。需要支持这些配置的正常平台入口。共用认证、全局存储规则和其他应用资源均不在修改范围。

## 恢复与回退

确认成功后回读；任务状态不明时不重发。新建空集合保留，不做自动删除回滚。函数新版本出错先停止本项目写入、保留数据；分享已启用时保留读取和撤销，不能因回退使有效链接无法管理。触发器和实际清理未授权，不创建或执行。当前执行进度以 `docs/DEPLOYMENT.md` 和 OpenSpec 任务单为准。
