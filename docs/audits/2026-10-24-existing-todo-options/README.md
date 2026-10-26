# 已有内容加入待办的日期选项验证（2026-10-24）

## 隔离工程

`qa/local/todo-options-20261024/project/` 使用游客 AppID，云开关关闭，空环境 ID，App 注入内存合成账户。`demo_options` 的正文、普通补充 `demo_option_plain` 与已并入正文的隐藏补充 `demo_option_hidden` 初始均为 `todo: null`。内存 transport 记录 action 数量，用于核对打开、选择、取消与确认时的写入次数；不调用正式云，不持久化到设备。

## 最终验证结果

- 官方原生编译通过：13 个 WXML、15 个 WXSS，返回值均为 0，诊断为空。
- `native-compile.json` 保存全部 WXML/WXSS 的 SHA256，并确认隔离副本与当前源码一致，含本次详情页最终样式和共享待办样式。
- 合成 App 在 Node 中加载成功，核对了三个目标均为 `todo: null`、隐藏补充带 `foldedAt`，内存写计数为 0。
- 开发者工具基础库 3.16.3、390px 宽模拟器完成本轮 8 张真实业务截图；最终回执 `runtime-relaunch-first.json` 为 `ok: true`，无运行时异常。
- 普通补充、正文和隐藏补充点击「加入待办」均先打开日期选项面板，并展示对应内容摘要；默认不设日期，可选今天、明天或自选日期。
- 普通补充和隐藏补充：打开、选择日期及取消前后，整条合成记录和内存写计数完全相同；重开并确认后各仅产生 1 次 `snapshot.push`，待办日期为所选明天，完成状态为空。
- 正文：打开和自选日期后未产生写入；确认后才产生 1 次 `snapshot.push`，日期为 `2026-11-05`。本轮三个确认累计 3 次内存写入，正文与两条补充各自保留独立待办。
- 实测日期按钮最小为 45×45px，自选日期 picker 为 70×45px，确认按钮为 361×49px，取消为 361×45px。所有测量均来自真实元素 `Element.size()`；普通和隐藏补充面板各测一次。
- 已目视检查普通补充、正文和隐藏补充面板，390px 模拟器中日期、确认和取消均完整可见，确认按钮保留左右留白；无需滚动即可确认。未进行内容溢出时的实际拖动滚动验证，样式保留 `max-height` 与 `overflow-y: auto`。

| 截图 | 场景 |
| --- | --- |
| `01-plain-options.png` | 普通补充点击后先显示选项，仍未写入 |
| `02-plain-tomorrow-before-confirm.png` | 选择明天，确认前仍未写入 |
| `03-plain-confirmed.png` | 确认后普通补充才成为待办 |
| `04-body-options.png` | 正文点击后显示内容摘要和选项 |
| `05-body-custom-before-confirm.png` | 正文自选日期值与高亮，确认前未写入 |
| `06-body-confirmed.png` | 正文确认后成为待办 |
| `07-hidden-options.png` | 展开隐藏补充后显示该补充的选项 |
| `08-hidden-confirmed.png` | 隐藏补充确认后成为待办 |

## 验证边界

自选日期通过实际 picker 组件的 `change` 事件注入合成日期，验证绑定、值展示、高亮和确认保存；未操作平台原生日期滚轮。未验证 320px 窄屏、正式云、正式账户或真机。

最初两次先读取 `getApp()` 的自动化尝试超时，回执保存在 `runtime.json` 与 `runtime-first-start-timeout.json`。最终复用同一 9442 端口，先调用 automator 原生 `reLaunch` 打开详情，再核验合成 App 标记，成功完成上述场景；未重启 CLI。最终业务验证以 `runtime-relaunch-first.json` 为准。
