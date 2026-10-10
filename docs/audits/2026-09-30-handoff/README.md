# 本轮体验审查证据

对应设计：[UX-HANDOFF-20260930.md](../../UX-HANDOFF-20260930.md)，[五页视觉稿](../../UX-HANDOFF-20260930.html)。

文案追加校对：[定稿与 COPY01—09](../../UX-COPY-20260930.md)。MD、HTML 与全部设计 PNG 已同步校对；O01—O22 为原始观察证据，保留原文字。校对覆盖术语、动作对象、失败与结果未知的区别、计数及品牌语。当前产品源码和旧版规范未按定稿修改。

## 环境与边界

- 日期：2026-09-30；分支dev；HEAD `ef4bcf9`；工作区已有未提交界面改动。本轮未修改业务源码。
- 当前页面复制到 `qa/local/inspiration-workflows`；替换为仓库既有 `tests/fixtures/devtools-app.js` 合成数据服务；云配置关闭；样例AI开关改为false以对应当前产品关闭状态。生产配置未改。
- 微信开发者工具自动化端口9420；SDK 3.17.2；模拟器 iPhone 12/13 (Pro)。逻辑窗口宽390、屏幕高844、windowHeight671；截图文件为363×785。测量以页面查询获得的CSS逻辑像素为准，不用缩放截图像素推导尺寸。
- 共22张当前页面截图，17张来自样例页面导航/实际点击/输入，5张为setData注入的视觉状态。保存成功是样例内存服务返回，不证明云端保存；未创建分享、未发消息、未调用AI、未上传照片。
- 样例照片使用品牌图路径，不满足私有照片真实读取条件；“重新查看照片”只作为失败状态布局观察，不认定生产图片存在故障。
- 所有截图已逐张打开检查。O04初次截图为切页过渡画面，已拒绝并在实际点击后等待详情稳定重新采集，最终文件已替换。

## 编号与截图

| 编号 | 截图 | 获取方式 / 有效证据 |
| --- | --- | --- |
| O01 | [记录初始](01-capture-empty.png) | 导航到记录页；主入口与视觉层级 |
| O02 | [输入中](02-capture-typed.png) | 实际输入合成文字；不是系统键盘验证 |
| O03 | [已记下](03-capture-saved.png) | 实际点保存；样例内存确认 |
| O04 | [新记录详情](04-detail-new.png) | 重采，实际点“查看这条”；等待稳定 |
| O05 | [已有记录列表](05-list.png) | 当前筛选与回顾卡顺序 |
| O06 | [搜索无结果](06-no-match.png) | 实际输入不存在的词 |
| O07 | [详情首屏](07-detail.png) | 合成两条补充及一张样例图片 |
| O08 | [详情下半部](08-detail-lower.png) | 实际滚动到时间线 |
| O09 | [补充操作](09-supplement-actions.png) | 实际点操作；已修复的文字布局 |
| O10 | [删除确认](10-delete-confirm.png) | 实际进入确认，未执行删除 |
| O11 | [整理选择](11-output-select.png) | 实际进入单条整理页 |
| O12 | [自由稿](12-output-draft.png) | 实际点生成；规则拼接，无AI |
| O13 | [跨条选材](13-material.png) | 实际进入选择页；未执行另存 |
| O14 | [我的](14-mine.png) | 首屏分组与会话设置；未截图部分仅作源码判断 |
| O15 | [分享预览](15-share-preview.png) | 只观察分享前选择与预览，不创建链接 |
| O16 | [分享暂不可读](16-shared-failure.png) | 离线样例读取失败；不是撤销/过期联调 |
| O17 | [未保存失败](17-save-failure-injected.png) | **注入**错误与输入；仅验呈现 |
| O18 | [真空列表](18-list-empty-injected.png) | **注入**空数据呈现，未清空服务数据 |
| O19 | [首次读取失败](19-list-failure-injected.png) | **注入**失败呈现，非真实弱网 |
| O20 | [无照片详情](20-detail-no-photo-injected.png) | **注入**无照片分支，辅助比较区块位置 |
| O21 | [长正文详情](21-detail-long-injected.png) | **注入**长文字，未改实际记录 |
| O22 | [缺失整理目标](22-output-missing.png) | 实际访问不存在的样例ID；页面缺明确返回按钮 |

[环境数据](environment.json) · [逐图备注](capture-notes.json) · [详情布局测量](detail-layout.json)。

详情测量顺序：`.origin` → `.detail-next` → `.organization` → `.photos-section` → 两个`.tl-item`。标记区top445.20、高102.39；照片top565.59、高129.78；首条补充top744.77。均为逻辑px，样例内容与测量场景相同。

## 视觉稿检查

- [推荐方向全景](design-board-a.png)：五个关键页面、双方向说明及当前页面对照。
- [320稿宽与异常状态](design-board-320-states.png)：保存未确认、搜索无结果；初检发现4处文字按钮热区被父级min-width覆盖，已修正并重测，此文件为修正后重采。
- [方向B](design-board-b.png)：冷灰/蓝、较紧凑排版、空列表与失败状态。
- 推荐方向独立390×844稿：[首次记录](design-v01.png) · [已记下](design-v02.png) · [再次查找](design-v03.png) · [详情补充](design-v04.png) · [整理成稿](design-v05.png)。
- [浏览器检查记录](browser-checks.json)：320/375/390/430四种稿宽，五个画面无内部横向溢出；视觉稿按钮均不小于44×44逻辑px；进行中、失败、空态的评审切换符合预期。只是HTML检查，不包括真实键盘、屏幕阅读器、小程序编译和后端操作。
- [文案校对后的复查](copy-browser-checks.json)：同样复查四种稿宽；结果未知时不再同时出现“尚未保存”，复制与清空操作明确对象，空记录不再表述成没有灵感。设计计数由示例正文实际计算。此记录是上述初版检查的后续，初版 JSON 中的旧文案仅保留为历史记录。
- [对比度计算](contrast.json)：10组主要文字/底色及输入边界组合达到设计阈值。未声称全产品无障碍合规。

## 本轮本地验证

| 命令 | 结果 | 解释 |
| --- | --- | --- |
| `npm test` | 396/396通过 | 当前工作区业务基线；新设计尚未实施，不能代表新验收已通过 |
| `npm run check` | 225项通过 | 语法/配置/页面结构，非真机运行 |
| `npm run openspec -- validate --all --strict` | 8/8通过 | 既有规范校验；本设计尚未作为实施变更落地 |
| HTML静态资源/脚本 | 见浏览器检查 | 品牌/图标/五张对照图正常加载；状态切换可用 |

未做：真实用户任务测试、转化/留存分析、真实云保存、AI调用、照片权限闭环、双账户隔离、好友分享/扫码端到端、iOS/Android键盘和可访问性验收。

## 复现

当前采集辅助脚本位于本机忽略目录 `qa/local/audit-handoff-20260930.cjs`、`qa/local/audit-handoff-extra.cjs`；它们是此次审查辅助产物，不是产品代码。其他机器可依照下列步骤和截图表复现；不要使用旧截图当新证据。

1. 核对dev分支、工作区与详细设计§0；在新的证据目录记录commit、差异、日期。
2. 运行 `node scripts/prepare-devtools-fixture.cjs`，仅在生成的qa工程内将 `aiEnabled: true` 改成false。确认生成工程的cloud.enabled=false，生产配置不动。
3. 使用本机已安装微信开发者工具：`cli.bat auto --project <仓库>/qa/local/inspiration-workflows --auto-port 9420`。
4. 用已安装 `miniprogram-automator` 连接 `ws://127.0.0.1:9420`；按表中的路径导航、输入、点击和截图。每步等待UI稳定，检查截图内容与实际页面一致；注入状态单独标记。
5. 用 `wx.createSelectorQuery().selectAll(...).boundingClientRect()`测量逻辑尺寸；保存系统信息，禁止将模拟器缩放后的截图尺寸当作布局px。
6. 独立预览：仓库根运行 `python -m http.server 8766 --bind 127.0.0.1`，打开 `/docs/UX-HANDOFF-20260930.html`。也可直接用浏览器打开HTML文件；图片保持仓库相对目录。

图片按仓库现有规则被Git忽略，未执行强制add。若交接到另一台机器，需要一并复制本目录PNG和`miniprogram/assets/brand-mark.png`、`assets/tabbar/`，保留相对结构；不复制身份、密钥、开发者工具私人配置或生产数据。

本轮尚未提交。
