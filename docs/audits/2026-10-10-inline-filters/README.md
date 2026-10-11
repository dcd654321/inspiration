# 顶部筛选验证（2026-10-10）

当前灵感列表将全部、有补充、七天内、已合并放在顶部第一行；全部阶段、想法、整理中、可使用以按钮放在第二行。选择即时更新列表，重置筛选保留搜索词。筛选区域已移除遮罩、底部面板与原生阶段选择器。

## 原生编译

[native-compile.json](native-compile.json) 记录微信开发者工具自带编译器对当前 `miniprogram/` 源码的结果：14 份 WXML、15 份 WXSS 均成功，进程退出码为 0，标准错误为空。

使用本机 `E:/weixinDevTool/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/` 的 `wcc.exe` 和 `wcsc.exe`。WXML 编译输出 164739 字节，WXSS 编译输出 64118 字节。编译结果证明语法可被原生编译器处理；布局、触摸操作和真机状态仍需渲染验收。

## 隔离工程与本次模拟器尝试

[fixture.json](fixture.json) 记录独立工程 `qa/local/inline-filters-20261010/project/`。该工程复制当前页面源码，替换为 `tests/fixtures/devtools-app.js` 的合成内存 App/store，云开关关闭，无云函数目录。基础库配置为 3.17.2；本轮没有取得运行中的窗口尺寸。

[runtime.json](runtime.json) 记录一次实际启动和一次自动化连接：CLI 启动退出码为 0，9427 自动化连接成功，隔离 App 的合成内存 store 已就绪，但 `getCurrentPages()` 为空。验证在读取页面栈时结束，操作与截图数量均为 0，未观察到产品页面的渲染结果。

此前 Windows shell 包装参数语法错误，未启动项目；原记录保留在 [cli-wrapper-failure.json](cli-wrapper-failure.json)。修正验证脚本后使用结构化参数调用 CLI 的 Electron 入口，完成上述一次实际启动和连接。本次未继续重启或修复开发者工具。准备、编译与验证脚本在 `qa/local/inline-filters-20261010/`，旧 QA 工程与旧证据未覆盖，正式 App 和项目配置未修改。

## 待验收

顶部八个筛选按钮的实际显示与选择反馈、点击即时生效、重置操作、390px 横向边界与 44px 触摸热区尚未取得模拟器证据。不同屏宽、大字体、真机键盘与账户切换仍需分别验收。本轮未部署、上传或访问正式账户数据。
