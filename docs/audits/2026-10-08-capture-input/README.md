# 记录输入焦点验证（2026-10-08）

环境为 `qa/local/mine-style-20261008` 的隔离开发者工具工程，云开关关闭、合成会话内存数据。只同步当前记录页源码；基础库 3.17.2，逻辑窗口 390×844，工具截屏 363×785。

| 文件 | 证据及边界 |
| --- | --- |
| `before-fix.json`、`01-before-fix-input.png` | 修复前的空记录页。普通自动化 tap 没有产出 focus 事件，不能据此证明真实点击失效 |
| `focus-before-fix.json` | 仅调用再记一条请求 focus 后的读回；没有 focus 事件，不作为问题复现 |
| `focus-event-before-fix.json` | 自动化触发绑定 focus 事件后，错误回调将 inputFocus 与原生 focus 撤回为 false/0；输入框未 disabled |
| `after-fix.json` | 同一绑定事件保持 true/1；blur 只复位焦点；合成保存后实际点击再记一条；切页恢复文字、不请求键盘；无运行异常 |
| `02-after-fix-input.png` | 修复后自动化录入的合成文字，输入框可编辑，记下来按钮启用 |
| `03-after-return.png` | 从我的页返回，恢复同账户文字 |
| `04-final-empty.png` | 验证结束后清除测试输入，停留空记录页 |
| `native-compile.json` | 当前 14 份 WXML 与 15 份 WXSS 原生编译通过 |

focus/blur 使用 `Element.trigger`；文字使用自动化 `.input()`。这些是事件绑定与渲染证据，不能据此宣布真实中文输入法、点击弹键盘或云端保存通过。真机录入与真实保存待验收，未操作正式数据。
