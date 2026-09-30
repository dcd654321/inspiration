# 第二轮界面实施证据（2026-09-30）

对应实施记录：[UX-IMPLEMENTATION-20260930.md](../../UX-IMPLEMENTATION-20260930.md)
对应设计依据：[UX-HANDOFF-20260930.md](../../UX-HANDOFF-20260930.md)、[UX-COPY-20260930.md](../../UX-COPY-20260930.md)。

## 环境与边界

- 分支 `dev`；用 `scripts/prepare-devtools-fixture.cjs` 重建离线样例工程（云开关 `false`、注入合成数据、不碰生产配置），并把样例 `aiEnabled` 改为 `false` 对应当前产品关闭状态。
- 微信开发者工具自动化端口 9420；模拟器 iPhone 12/13 (Pro)，逻辑窗口 390×844、`windowHeight` 671；截图文件为 363×785 的缩放图，布局测量一律用 `boundingClientRect` 的逻辑像素，不换算截图像素。
- 共 37 张图：真实导航 / 点击 / 输入产生的为主；文件名或备注里标 `injected` 的是 `setData`/页面方法注入的呈现状态，只证明呈现，不证明该状态在真实运行中自然发生。
- 保存成功由离线内存服务返回，**不证明云端保存**；未创建分享、未发消息、未调用 AI、未上传照片。

## 截图索引

| 文件 | 状态 | 获取方式 |
| --- | --- | --- |
| 01-capture-empty | 记录页空态（去掉示例行后重采） | 实际导航 |
| 02-capture-typed | 输入中 +「尚未保存」提示 | 实际输入 |
| 03-capture-saved | 成功卡（摘录 + 继续补充 / 再记一条） | 实际点击保存（内存确认） |
| 04/04b-detail-after-continue | 截图是切页过渡帧；跳转与聚焦由 `continue-supplement-state.json` 证明（详情页、composeFocus=true） | 实际点击「继续补充」 |
| 05-capture-overlimit-injected | 超限注入（onInput 直调，模拟粘贴全文） | 注入 |
| 05b-capture-overlimit-scrolled | 滚到底：超出 430 字符提示 + 2430/2000 + 置灰 | 注入 + 实际滚动 |
| 06-capture-unknown-injected | 「尚未确认保存」+ 重试保存 / 复制内容 | 注入 |
| 07-capture-rejected-injected | 「未能保存」+ 已知原因 | 注入 |
| 08-list | 区头「最近更新 · 共 N 条」；默认筛选行三个 chip；回顾行在第一条之后（自查修正 C25 后重采） | 实际导航 |
| 09-list-filter-panel | 筛选面板（七天内 / 阶段 / 已合并） | 实际点击 |
| 10-list-review-expanded | 回顾行展开（继续补充 / 本次先不看） | 实际点击 |
| 11-list-empty-injected | 真空态：只有标题、空态卡、主按钮 | 注入 |
| 12-list-failure-injected | 首次读取失败 + 重新读取 | 注入 |
| 13-detail | 详情首屏新顺序；两条补充均在首屏内 | 实际导航 |
| 14-detail-more-panel | 「更多」面板（修改正文 / 复制全文 / 分享文字 / 删除灵感） | 实际点击 |
| 15-detail-lower | 滚到时间线之后：标记行与照片 | 实际滚动 |
| 16-detail-supplement-sheet | 补充面板（复制补充 / 修改补充 / 并入正文 / 删除补充） | 实际点击 |
| 17-detail-delete-dialog | 删除确认（含内容摘录与时间） | 实际点击；不确认 |
| 18/18b-detail-compose-focus | 补充输入聚焦态 | 实际点击 / 聚焦 |
| 19-output-edit | 进入即稿件（正文 + 2 条补充） | 实际导航 |
| 20-output-content-panel | 调整内容面板 | 实际点击 |
| 21-output-format-panel | 选择格式面板 | 实际点击 |
| 22-output-more-panel | 更多（文字留档） | 实际点击 |
| 23-output-archive | 文字留档面板 | 实际点击 |
| 24/25-mine(-lower) | 我的分组 / 使用帮助 / 反馈 / 关于 | 实际导航 + 滚动 |
| 26-feedback | 反馈页新文案 | 实际导航 |
| 27-share-preview | 单一主按钮 + 准备分享 | 实际导航；不创建 |
| 28-shared-failure | 暂无法查看 + 重新读取 + 记录我的想法 | 实际导航（离线失败） |
| 29-history-empty | 修改记录空态 | 实际导航 |
| 30-ai-disabled | 暂时无法使用此功能 + 返回灵感列表 | 实际导航 |
| 31-my-shares-empty | 截图是离线读取失败态（失败不当空态，行为正确）；空态仅结构测试覆盖。撤销弹窗（C69）在离线样例不可达，以回归测试覆盖 | 实际导航 |
| 32-detail-float-supplement | 长文滚离原文后的浮动「继续补充」 | 注入长文 + 页面自身测量 + 实际滚动 |
| 33-list-merged-only-injected | 仅剩已合并的提示与入口 | 注入 |
| 34-detail-missing | 找不到这条灵感 + 返回灵感列表 | 实际导航（无效 id） |
| 35-output-replace-confirm | 替换当前稿件？弹窗（保留编辑 / 替换稿件） | 实际点击路径 |

## 测量与机器可读记录

- [environment.json](environment.json)：设备与 SDK。
- [detail-layout.json](detail-layout.json)：新顺序的文档位置——原文 top 49、动作行 134、补充输入 195、首条补充 391、第二条 500、标记行 624、照片 713（逻辑 px）。首条补充从旧版 745px 上移到 391px，两条补充都进入 671px 首屏。
- [compose-heights.json](compose-heights.json)：补充输入空态 66px、聚焦/有内容态 166px（64/160 设计值 + 边框），两档切换成立；文件内注明了两态各自的获取方式（自动化 tap 不弹键盘，聚焦态以「继续补充」路径为准）。
- [hit-areas.json](hit-areas.json)：390 宽下关键按钮 45px 高（≥44px）；列表「记一条灵感」82×45、筛选 chip 45、回顾行 49、详情「更多」48×45、动作按钮 171×45。
- [continue-supplement-state.json](continue-supplement-state.json)：成功卡「继续补充」→ 详情页且 `composeFocus=true`。
- [console-events.json](console-events.json)：仅两条 `wx.getSystemInfoSync` 弃用警告（采集脚本自身调用），无业务报错。

不覆盖：真机、系统键盘、320/430 宽、1.3 倍字号、读屏、真实云端、双账户、分享创建与接收端、照片全链路。开发工具模拟器上的结果不能替代这些验收。
