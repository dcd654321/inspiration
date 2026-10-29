## Context

欢迎页为唯一允许索引的页面，展示固定产品内容，不依赖账户。业务页均通过 ensureReady 或 readPageAccount 请求可信账户。现有 onHide 会使旧会话失效并清理可见个人数据。

## Goals / Non-Goals

- Goals：公开页可独立阅读、用途清楚、分享展示一致；不访问业务页时不启动账户读取。
- Non-Goals：修改后台名称与搜索配置、扩大公开数据范围、接入搜索推送服务、增加统计资源或调整排名。

## Decisions

- 欢迎页保留原生 WXML，流程与 FAQ 默认可读，按钮继续调用 startCapture，保留输入接续契约。
- services/product-presentation.js 提供无参数的 createAppShare()、createTimelineShare()，每次返回新的固定对象；不接收正文、账户或路由参数。封面为仓库内固定产品图片 assets/product-share.png。
- App 不再在 onLaunch/onShow 主动 refreshAccount；ensureReady/refreshAccount 记录当前会话已请求账户。网络监听仅在前台且本会话请求过账户时恢复读取，onHide 重置请求标记并使旧响应失效。
- 运营会话保持原有可信账户绑定后才上报；只阅读公开介绍不产生账户绑定，不新增匿名上报。
- sitemap 保持 welcome 白名单及通配拒绝。该配置不替代服务端鉴权，也不证明已被微信收录。

## Risks / Trade-offs

- 业务页必须显式请求账户；以所有现有业务页读取路径、首次进入、弱网重试及前后台隔离回归守住。
- 静态产品封面仅展示固定品牌与能力，不读取或嵌入个人记录；朋友圈和聊天分别检查裁切。
- 搜索结果与真实设备表现只能通过发布后平台与真机证据确认。

## Migration Plan

无数据迁移、后端协议或部署变更。回退本次公开页、分享与 App 生命周期修改即可恢复此前行为，保留其他未提交改动。
