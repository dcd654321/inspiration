# 2026-10-09 全量审查证据

等级F：本机微信开发者工具隔离样例，合成内存数据，云服务关闭。基础库3.17.2，逻辑390×844，PNG缩放363×785。所有证据来自本次运行。

## 截图

- `before/01`—`14`：修改前14页默认态；launch正常转入capture。
- `before/15-saved-card.png`、`16-list-new-entry.png`：保存后列表新记录入口仍恢复同一成功卡的复现。
- `after/01`—`14`：修改后14页默认态。
- `after/15`—`18`：合成保存、新入口清卡、未提交文字接续。
- `after/19`：稳定的详情补充定位；初次导航过渡截图未验收，已重拍。
- `after/20`—`22`：两段素材顺序、工作提纲、单条格式面板。
- `after/23`—`24`：反馈历史失败与模拟成功重试，输入保持。成功重试响应明确为样例替身，无真实提交。
- `after/25`：真实帮助行 tap 展开。初次脚本参数不匹配的画面已重拍；最终状态见 `mine-final.json`。

PNG按仓库既有规则忽略，文件在当前工作区；JSON及本索引可供审阅。Contact拼图仅用于视觉检视，不替代原图。

## 机器结果

| 文件 | 用途 |
| --- | --- |
| `before/captures.json` | 默认页面路径、数据和日志；全为合成样例 |
| `before/entry-reproduction.json` | 同一 savedId 被列表入口恢复的复现 |
| `after/captures.json` | 14页修改后默认状态 |
| `after/flows.json` | 保存、新入口和未提交接续的前半段结果；step19过渡画面仅属未完成捕获，使用后续稳定结果 |
| `after/flows-rest.json` | 补充定位、选材、格式和反馈重试；mine步骤最终由下项替代 |
| `after/mine-final.json` | 帮助行native tap、展开状态与当前SDK/窗口 |
| `event-bindings.json` | 14页静态绑定处理方法完整性 |
| `native-compile.json` | 14份WXML、15份WXSS编译结果 |
| `verification.json` | 最终测试、构建、规范与差异摘要 |

脚本与原修改前文件清单在忽略目录 `qa/local/full-review-20261009*`。模拟器输入事件与 `.input()` 不等于真机中文输入法验证。照片失败和云业务读取失败来自云关闭条件，不作为线上根因。
