## Context

正式版使用 product-d2g59zty74d7d1ec1，开发/体验版使用 cloud1-d8gopnalv908bb47a，资源方 wx7ad85943fe81e095。可信来源为 wxed8fdc5d559d973d，对应看板 appId=linggan。

## Decisions

- 每次 onShow 生成一个 sessionId，可信 snapshot.pull 完成后绑定账户与 generation，发送 start/app_start；每 60 秒发送累计前台毫秒 heartbeat，onHide 发送 end 后停止计时。start 成功回执返回 startedAtMs、observedAtMs 与服务端已收 elapsedMs；首次成功后以本次成功尝试的本地发起时刻减去 observedAtMs-startedAtMs 作为累计起点，不能在 ACK 到达时重新起算。旧服务端缺字段时按成功尝试发起时刻兼容。账户确认后的采集等待属于前台时间，账户初始化和隐藏时间不累计；心跳/end 采样时刻在排队前固定。首次 start 两次失败后，后续 heartbeat/end 在当前代际下重新确认同一 sessionId，成功后再发送后续累计值；丢失 ACK 的重复 start 复用首次服务端起点和访问。每个请求最多一次内存重试，不落盘；账户、代际与会话失效取消迟到上报。业务保存不等待运营采集。
- monitorApi trackUsage 信封为 {action,eventType,sessionId,elapsedMs,accountGeneration}；ingestEvent 为 {action,type,eventId,payload,accountGeneration}。accountGeneration 只从本次可信 snapshot.pull 复制，重试不更新。payload 只允许 route/functionName/code/durationMs/sessionId/envVersion。监控自身调用不产生耗时/错误事件。可信账户确认前仅在当前会话内存中保留最多 8 条已过滤事件，确认后发送；会话结束或账户无法确认则丢弃。
- monitorApi 在成功 start 的同一事务中创建确定 eventId=sessionId+':start' 的 app_start，客户端兼容启动埋点复用相同标识，迟到请求仅作为重复接收，保留首次服务端时间。start 时间字段仅为监控响应元信息，不新增业务账户字段；服务端提交与复制/导出事件仍为尽力采集，故障期间可能永久漏报。
- output_copied 在整理稿剪贴板 success 后上报；output_exported 在 TXT writeFile success 后上报；用户发送或取消文件不重复计导出。
- repository.push 接收可选受信 context={sourceUserId}，在实际 CAS 提交成功后调用可选 onCommitted。与旧快照比较：新记录总记 record_saved；新记录自有 templateId 另记 output_saved；新补充记 supplement_saved。编辑、完全相同重试、冲突及失败不记成功事件。
- sourceUserId=user_+SHA256(appid+'|'+openid).slice(0,24)，来源仅取 cloud.getWXContext；事件写入先定位账户物理 _id，事务重读 accountKey/generation 与提交代际一致，再 update 账户顶层 _monitorFence=db.command.inc(1)，最后 add 事件。实际账户写使并发代际变更形成写冲突，重试时拒绝旧代际，避免只读快照校验后重建统计。确定性 _id 的重复创建不覆盖时间。事件时间使用服务端 Date，payload={}，不存实体内容。监控失败只留下稳定码，不改变保存成功响应。
- _monitorFence 可选缺省 0，由服务端递增；业务 CAS 仅 update 业务字段并保留它，pull 不输出它。空初访 generation=1 不创建账户；当前灵感没有清空账户入口，未来加入清空需原地账户代际更新与运营清理闭环。
- 主保存确认最多等待运营回调 500 毫秒，超时输出 MONITOR_WRITE_TIMEOUT，返回已提交的版本；回调迟到拒绝被处理。客户端通过独立异常边界调用启动、绑定、结束、运行信号和复制/TXT 上报，同步抛错和异步拒绝不能影响账户或成功状态。

## Validation and Rollout

本地验证会话/账户守卫、单次重试、隐私白名单、成功回调、提交差异与幂等失败隔离；运行全量测试、云副本构建、check 与 OpenSpec strict。生产 monitorApi 部署、权限、真实调用与真机验证不包含在本地实现中。
