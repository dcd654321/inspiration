# Tasks

- [x] 1. 记录用户部署授权和非目标，核查 dev 分支及保留工作区修改；抓取 origin/dev 后远端无新增提交，本地领先原有一个提交。
- [x] 2. 发布提案纳入后检查通过：345 项测试、202 项结构检查、7 项规范变更；git diff --check 通过。
- [x] 3. 用户确认 product-d2g59zty74d7d1ec1 和资源方 wx7ad85943fe81e095；资源方 cloud_env_list 已返回该环境，集合/函数列表均无 linggan_ 资源。
- [x] 3.1 用户明确授权后完成四项共享适配；新增 11 项共享环境测试通过，全套 356 项通过。共用 cloudbase_auth、其他应用和全局存储规则未改。
- [ ] 3.2 本轮照片模板的真实 WXML/WXSS 编译和渲染，以及共享初始化/两账户/审核归属的真实平台验收。
- [x] 4.1 共享适配后再次校验生成目录范围和无重解析点，同步 39 个副本；210 项结构检查及副本一致性通过，未自动提交。旧代码摘要已失效，实际上传前须重算。
- [ ] 4.2 记录线上版本及恢复方式，确认旧客户端兼容窗口；若环境或配置调整，重新校验并记录摘要。
- [ ] 5. 重新读取资源状态；先补依赖集合和索引，核验所有本项目集合的客户端全拒绝规则。唯一索引失败停止，不删除冲突数据。2026-09-28 回读六集合均为空；非 AI 所需十四个业务索引已回读成功，AI 专用索引因 AI 暂不开放而暂缓。
- [x] 5.1 整理六集合、十五业务索引（含五唯一）和三个函数至 deployment/product；索引输入不含删除或 TTL，环境变量清单无密钥值。
- [x] 5.2 查询旧账户集合任务确认成功，并以资源方完整集合列表回读 linggan_accounts（Count=0）；尚未创建其业务唯一索引或验证权限。
- [x] 5.3 查询分享集合任务确认成功，完整集合列表回读 linggan_accounts、linggan_shares 均为空；索引列表确认两者各仅有平台自带 _id_、_openid_1，业务索引尚未创建。
- [x] 5.4 查询反馈集合任务确认成功，并回读 linggan_accounts、linggan_shares、linggan_feedback 均为空；已发起 usage 创建，等待平台确认。
- [x] 5.5 查询 usage 集合任务确认成功并回读四个 linggan_ 集合均为空；rate_limits 创建请求已发起，等待平台确认。
- [x] 5.6 查询 rate_limits 任务确认成功并回读五个 linggan_ 集合均为空；最后一个 ai_usage 集合尚未创建。原微信工具不支持批量建集合，用户要求不再逐笔确认。
- [x] 5.7 曾在已忽略的 qa/local 目录准备官方 CloudBase CLI 3.8.4，并验证本地批量配置；登录未成功，未产生任何 CLI 云写。用户现要求不用该路线，已移除批量配置及其测试；此项只保留历史尝试记录，不计作部署完成。
- [x] 5.8 查询 `linggan_ai_usage` 集合创建任务为成功，回读确认六个本项目集合均存在且为空。随后核对 `linggan_accounts` 仅有两个平台自带索引，发起 `accountKey` 唯一索引创建，当前待平台确认。
- [ ] 6. 核实分享凭据、审核权限、超时及照片前置配置，不在日志/仓库存储凭据，不覆盖共享规则。
- [ ] 7. 分别部署 linggan_api、linggan_ai、linggan_maintenance，记录每次成功结果；AI 不启用，维护函数无触发器且不执行清理。
- [ ] 8. 受控账户与合成内容验证记录、补充、同步、复制、分享接收/撤销、反馈；双账户与真机分别留证据。
- [ ] 9. 上传配套小程序版本，记录版本号、上传结果；平台审核和公开发布单独确认。
- [x] 10A. “我的”页分享小程序改为直接调用微信分享，卡片只使用公共入口；新增 Node 测试通过。实际聊天与朋友圈卡片待真机验收。
- [ ] 10B. 照片按私有存储规则与双账户上传/预览/删除验收后开放；不将照片加入分享或 AI。
- [x] 10C. 用户明确选择“先不开放 AI”；本轮保持客户端 `config/ai.js` 关闭且不发起模型调用。后续如要开放，另核对模型、预算、超时、审核、额度和真实调用。

## Pending Task

- 当前无待确认的索引写入任务。`confirmation_cloud_db_write_struct_fd0073c3-8d58-4ed4-89ad-2cd7f27561f2` 查询返回 `success / execution_success`，并回读确认 `linggan_rate_limits.expiresAt_asc` 已存在。
- 官方 CloudBase CLI 登录未成功，原进程已结束；用户要求不再使用该路线。不得复用本机登录文件、猜测密钥或调用隐藏接口。微信开发者工具当前受支持的云写接口按单集合/单函数执行且逐笔等待平台确认；用户再次明确要求继续创建，已发起上一条待确认操作。
- 余项：15 个业务索引中非 AI 所需 14 个已回读成功、1 个 AI 专用索引未发起；六集合客户端全拒绝规则、三个函数版本与配置，以及实际验收。不得把函数 Active 状态当成代码版本、环境变量与云调用权限均正确。

## Completed Cloud Task

- AI 配额集合任务：`confirmation_cloud_db_write_struct_b84508cf-f347-4b06-b2e0-55e44d8db0e2`，返回 `status=success / detail=execution_success`，创建 requestId=`bb52533f-7c98-4810-81aa-eff100e71e91`。集合列表 requestId=`66de1741-c13e-485c-8256-537b9051bab8` 回读六个本项目集合均存在且 Count=0、IndexCount=2；未重复创建。
- 限流集合任务：`confirmation_cloud_db_write_struct_f2896fc3-efee-4a84-9ba7-3778a9416b85`，返回 `status=success / detail=execution_success`，创建 requestId=`79e46139-cdd4-4c03-9e25-65d7d70b75b3`。集合列表 requestId=`9e6b8964-dc45-4f4f-85e2-e62c89a033ff`，确认 `linggan_rate_limits` 存在且为空；未重复创建。
- 配额集合任务：`confirmation_cloud_db_write_struct_7d75bcd9-869d-44db-bee1-13615d421447`，返回 `status=success / detail=execution_success`，创建 requestId=`b1b968d0-7b39-4ee3-b2b4-7dbc74c3e0eb`。集合列表 requestId=`667198df-183a-4f1e-ae80-2616e4a2f52c`，确认 `linggan_usage` 存在且为空；未重复创建。
- 反馈集合任务：`confirmation_cloud_db_write_struct_04b659a0-5292-470a-9d3f-965611a0fa70`，返回 `status=success / detail=execution_success`，创建 requestId=`f4d634ab-cbeb-4eb0-a3c6-9df85cd9e24a`。集合列表 requestId=`c60e4886-17b8-406d-bbe6-b3934d019e0b`，确认 `linggan_feedback` 存在且为空；未重复创建。
- 分享集合任务：`confirmation_cloud_db_write_struct_9906885f-69f2-450a-aa7c-a805162abf78`，返回 `status=success / detail=execution_success`；创建 requestId=`f1992c87-5492-46c5-a061-e921dee57db2`。随后集合列表 requestId=`7d1568d1-e6af-48be-acc8-76e8deb374d0` 确认 linggan_shares 存在且为空；未重复创建。
- 原任务：`confirmation_cloud_db_write_struct_5e0105b9-6089-41b6-9faa-a52ede9a632c`；创建同一 product 环境的 `linggan_accounts`。
- 查询结果：`status=success`，`detail=execution_success`，内部结果 `success=true`、`message=云开发数据库集合创建成功`。
- 创建 requestId：`2c972983-3743-4c33-ba7c-58ffca52bf73`；随后集合列表 requestId：`cc8f91ac-5614-4531-8cad-8af94e95a3dc`，确认集合存在且为空。未重复创建。
