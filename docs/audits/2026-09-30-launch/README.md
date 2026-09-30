# 启动过渡页证据（2026-09-30）

对应实施记录：[UX-IMPLEMENTATION-20260930.md](../../UX-IMPLEMENTATION-20260930.md) 附录；设计说明见 [ui-design.md](../../ui-design.md) §11。

## 环境与边界

- 离线样例工程（`scripts/prepare-devtools-fixture.cjs`，云开关 `false`、合成数据、AI 关闭）；模拟器 iPhone 12/13 (Pro)，390×844。
- 样例工程没有真实云端读取，因此「正在读取」这一窗口用运行时注入制造：打开云开关、把 `ensureReady` 挂起（只改样例进程内存，不改任何源码与配置）。三张状态图里的倒计时、慢读取与失败态因此是**注入的呈现**，只证明界面与状态机；真实弱网/超时行为需真机与真实云端验收。
- 第四次跳转（重试成功 → 记录页）是真实执行路径：`transition-check.json` 记录 `wx.switchTab` 的调用与最终 `getCurrentPages()` 路由。

## 截图

| 文件 | 状态 | 获取方式 |
| --- | --- | --- |
| 01-launch-loading | 读取中：品牌标识 + 「让想法慢慢成形。」+ 拾光轨道 + 「正在读取你的灵感…」 | 注入挂起的读取后导航到启动页 |
| 02-launch-slow | 慢读取：状态改「读取还在进行…」，露出「重试 / 先进入记录页」 | 调页面自身 `markSlow()`（等价 8 秒兜底） |
| 03-launch-failed | 失败：展示既有账户错误文案 + 重试 + 先进入记录页 | 调页面自身 `fail()` 注入错误文案 |
| 04-capture-after-launch | 重试成功 → 切入记录页（tab bar 正常） | 真实调用 `onRetry()`，异步读取返回成功 |

环境数据见 [environment.json](environment.json)，跳转校验见 [transition-check.json](transition-check.json)。

不覆盖：真实冷启动全链路（微信系统启动画面 → 本页 → 读取完成）、真机弱网时序、`prefers-reduced-motion` 的系统设置联动。这些留待真机验收。
