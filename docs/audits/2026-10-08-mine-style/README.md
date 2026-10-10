# 我的页原生样式证据（2026-10-08）

使用当前页面源码的独立开发者工具样例，云开关关闭，数据仅在会话内存中。逻辑窗口 390×844，截屏实际像素 363×785；环境记录见 `environment.json`，不能据截屏缩放声称验过另一设备宽度。

| 文件 | 状态与步骤 |
| --- | --- |
| `source-reference.png` | 用户提供的样式参考图 |
| `01-mine-default-390.png` | 重新进入我的页，默认说明收起 |
| `02-mine-privacy-390.png` | 点击数据与隐私，展开两条说明 |
| `03-mine-help-390.png` | 点击使用帮助，收起隐私并展开三句说明 |
| `04-mine-collapsed-390.png` | 再次点击使用帮助，收起说明 |
| `05-my-shares-navigation-390.png` | 点击我的分享后的稳定页面；云服务关闭，仅验证导航，未验证真实列表数据 |
| `06-mine-return-390.png` | 从我的分享返回我的页 |
| `07-mine-final-preview-390.png` | 返回我的页后的最终默认预览 |
| `comparison-full.png` | 参考屏幕裁取并归一尺寸后与默认页合并比较 |
| `comparison-support.png` | 支持卡片局部并排比较 |

原生编译结果见 `native-compile.json`；点击步骤与页面状态见 `captures.json`；尺寸及无横向溢出测量见 `layout.json`；运行消息见 `console-events.json`。截图逐图查看并对照参考，结论及差异范围见仓库根 `design-qa.md`。

真实微信分享、原生反馈提交、云端数据、320px、系统大字体和真机未验收。测试、原生编译和隔离工程点击均为本地证据。
