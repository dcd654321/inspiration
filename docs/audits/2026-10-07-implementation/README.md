# 本地优化原生验证 · 2026-10-07—08

Windows微信开发者工具Stable2.02.2608060，隔离合成工程，逻辑390×844，基础库3.17.2。每张截图记录UTC时间。全部为F：生产页面源码在原生模拟器编译运行，合成文字、内存store或页面client替身。无真实云写、模型调用、照片上传、平台发送或用户样本。

[完整画廊](screenshots.html) · [审查前证据](../2026-10-07-review/README.md) · [本地实施报告](../../PRODUCT-EXPERIENCE-IMPLEMENTATION-20261007.md)

| 截图 | 页面 | 状态 | 操作步骤 | 等级 | 时间UTC |
| --- | --- | --- | --- | --- | --- |
| [01-home](01-home.png) | pages/capture/index | 改版首页空输入 | 启动注册完成后直达可写首页 | F | 2026-10-07T23:02:44.350Z |
| [02-record-saved](02-record-saved.png) | pages/capture/index | 首记确认成功 | 合成文字输入→内存store确认→补充/整理/再记首屏动作 | F | 2026-10-07T23:03:14.692Z |
| [03-output](03-output.png) | pages/output/index | 首记直接成稿 | 首记成功→整理这条→即时可编辑自由稿 | F | 2026-10-07T23:03:18.774Z |
| [04-output-copied](04-output-copied.png) | pages/output/index | 编辑和复制 | 编辑合成活动稿→复制；非真实保存 | F | 2026-10-07T23:03:20.816Z |
| [05-save-share-confirm](05-save-share-confirm.png) | pages/output/index | 另存后分享原生确认 | 合成稿→保存并预览分享→原生确认弹窗 | F | 2026-10-07T23:05:53.823Z |
| [06-share-preview](06-share-preview.png) | pages/share-preview/index | 成稿分享范围核对 | 原生确认→内存另存→直达分享预览；未准备真实token | F | 2026-10-07T23:06:16.074Z |
| [07-share-return](07-share-return.png) | pages/output/index | 取消分享返回保留编辑稿 | 分享预览返回→同会话重新核验→恢复已存稿 | F | 2026-10-07T23:06:21.138Z |
| [08-material-select](08-material-select.png) | pages/material-output/index | 选材成稿选择态 | 进入素材列表，默认无选材，固定计数与动作 | F | 2026-10-07T23:06:29.288Z |
| [09-material-draft](09-material-draft.png) | pages/material-output/index | 紧凑多素材结果页 | 两段选材→成稿；默认收起格式，复制首屏可见 | F | 2026-10-07T23:09:40.027Z |
| [10-material-resume](10-material-resume.png) | pages/material-output/index | 原生返回后恢复全文与选材 | 多素材稿→欢迎页→wx.navigateBack返回；两段选材与全文仍在 | F | 2026-10-07T23:10:03.610Z |
| [11-save-unknown](11-save-unknown.png) | pages/material-output/index | 未知另存反馈和恢复动作首屏可见 | fixture NETWORK→完整稿冻结；208px只读区、说明、复制/重试 | F | 2026-10-07T23:13:07.073Z |
| [12-save-retry](12-save-retry.png) | pages/material-output/index | 原稿重试确认成功 | 恢复内存确认→重试同一产物；实际幂等由行为测试证明 | F | 2026-10-07T23:10:07.888Z |
| [13-share-default](13-share-default.png) | pages/share-preview/index | 私人记录默认仅正文 | demo_1分享预览；两条补充默认不选 | F | 2026-10-07T23:13:15.681Z |
| [14-share-ready](14-share-ready.png) | pages/share-preview/index | 合成准备完成且好友按钮可达 | 页面client合成share.create回应；未发送 | F | 2026-10-07T23:13:18.415Z |
| [15-shared-template](15-shared-template.png) | pages/shared/index | 公开文字与合法用途的接收状态 | 禁用云的隔离工程注入公开白名单页面状态；未真实share.get | F | 2026-10-07T23:13:58.761Z |
| [16-template-capture](16-template-capture.png) | pages/capture/index | 接收者承接用途，无旧记录或恢复提示 | 公开白名单页面合成状态→点击接收CTA→实际switchTab；只承接work用途，不复制作者正文 | F | 2026-10-07T23:18:06.770Z |
| [17-shared-unavailable](17-shared-unavailable.png) | pages/shared/index | 分享失效后仍可开始自己的记录 | 隔离工程注入明确不可用的公开状态；核对失效说明和返回记录入口 | F | 2026-10-07T23:18:20.907Z |
| [18-detail](18-detail.png) | pages/detail/index | 详情保持原文与补充时间线 | 内存合成记录→查看详情；补充和整理为主操作，AI为文字入口 | F | 2026-10-07T23:18:30.386Z |
| [19-ai-resume](19-ai-resume.png) | pages/ai-workbench/index | AI预览同会话导航返回恢复 | 页面AI替身产生明确合成的三段预览→原生进入欢迎页→返回；未调用模型、未采纳保存 | F | 2026-10-07T23:19:23.084Z |

初次原生复核发现onLoad立即跳转时wx/not-found注册异常，改为onReady跳转后实际进入记录页。分享确认使用4字按钮。分享返回实际保留手工稿和已存ID。截图之外的账户切换、generation、来源变化和迟到回执由行为测试验证，真实账户及真机待验。

开启返回提醒时automator导航可能等待原生动作并超时；运行截图和当前页读取分阶段进行，不把超时说成页面丢稿。早期09若已被最终紧凑布局截图覆盖，以该文件和JSON时间为准。
