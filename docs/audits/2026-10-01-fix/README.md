# 2026-10-01 修复后证据

基线dev/a6dd036的工作区修复；报告：[修复记录](../../UI-INTERACTION-FIX-20261001.md)。当前页面源码真实WXML/WXSS在微信开发者工具独立QA工程渲染，逻辑390×844、截图363×785、基础库3.17.2。合成内存数据，云和AI关闭。

| 场景 | 证据 |
| --- | --- |
| 多素材选择/成稿 | [01选择](01-material-selection.png)、[02稿件](02-material-draft.png) |
| 单条稿件与离开风险说明 | [03](03-output.png) |
| 格式/内容安全区 | [04](04-format-safe.png)、[05](05-content-safe.png) |
| 长留档三动作 | [06](06-archive-three-actions.png)、[17滚动到底及状态提示](17-archive-last-line.png) |
| 另存等待冻结/确认/再编辑 | [07](07-output-frozen.png)、[08](08-output-confirmed.png)、[09](09-output-new-edit.png) |
| NETWORK未知提示 | [10](10-output-unknown.png) |
| 补充原生焦点 | [11](11-compose-focused.png)；native focus=1，不等于真机输入法已验 |
| 补充等待冻结/确认 | [12](12-supplement-frozen.png)、[13](13-supplement-confirmed.png) |
| 同会话读取失败保留列表 | [14](14-list-retained.png)；3→3，查询/锚点另有Node断言 |
| 照片重试安全区 | [15](15-photo-safe.png)、[19最终代码](19-photo-final-safe.png)；样例照片不可读，不代表线上故障 |
| 详情菜单安全区 | [16](16-detail-menu-safe.png) |
| 100条材料末项 | [18](18-material-100-bottom.png)；末项与底栏≥8px |

`verification.json` 是保存交互、原生属性与布局测量；`final-layout.json` 是最终代码长留档滚动、状态反馈、100条材料与照片的补验；`checks.json` 是本地检查结果与差异边界。

延迟写入/NETWORK/读取失败、100条材料、长留档、TXT第三按钮及生成反馈为合成注入；没有实际写TXT、发送文件、创建分享、提交反馈或上传照片。长留档滚动与底部按钮几何为真实组件运行结果。旧复核截图保留在相邻的 `2026-10-01-review`，两目录含义不同。

全部19张截图已查看；437/437测试、255项check、9/9规范通过。其他宽度、真机键盘、真实返回弹窗/手势/读屏、真实服务及多账户未验证，不能用本目录替代。
