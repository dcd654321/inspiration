# 待办入口界面验证（2026-10-23）

## 本地模拟器边界

- 工程：`qa/local/todo-ui-20261023/project/`，复制本次小程序源码，替换为 `tests/fixtures/todo-devtools-app.js` 合成账户。
- 云配置：`enabled: false`、空环境 ID；无正式云连接与账户数据读写。
- 合成数据：仅 `demo_*` 灵感，保存请求由内存 transport 返回；不持久化到设备。
- 游客 AppID 只用于隔离工程；主工程 AppID 和云配置未修改。

## 最终验证结果

- 官方原生编译：13 个 WXML、15 个 WXSS 均返回 0，诊断为空；新增 `styles/todo-entry.wxss` 纳入编译。隔离副本与当前源码逐文件 SHA256 相同，详见 `native-compile.json`，未覆盖 2026-10-21 历史回执。
- 开发者工具：基础库 3.16.3、390px 宽模拟器，最终版本取得 11 张业务页截图。`after-runtime.json` 与 `date-controls-runtime.json` 均为 `ok: true`，无运行时异常。
- 记录与补充：加入待办关闭/开启、说明、展开日期、今天/明天/自选日期单项高亮显示正常；输入后保存按钮均显示「添加待办」。
- 点击尺寸：通过真实元素 `Element.size()` 测得记录页开关为 316×60px、补充页开关为 320×60px，日期选项高度均为 45px、宽度最小 45px，自选日期值完整显示。
- 待办页：顶部「添加待办」入口与记录、补充使用相同清单图标和视觉样式。

| 截图 | 场景 |
| --- | --- |
| `after-01-capture-default.png` | 记录页：加入待办关闭 |
| `after-02-capture-todo-selected.png` | 记录页：开启后展开日期 |
| `after-03-detail-default.png` | 详情页：补充待办关闭 |
| `after-04-supplement-todo-selected.png` | 详情页：补充待办开启 |
| `after-05-todos-add-entry.png` | 待办页：添加入口 |
| `after-06-capture-today.png` | 记录页：今天高亮与保存按钮 |
| `after-07-capture-tomorrow.png` | 记录页：明天高亮与保存按钮 |
| `after-08-capture-custom-date.png` | 记录页：自选日期值、高亮与保存按钮 |
| `after-09-supplement-today.png` | 补充：今天高亮与保存按钮 |
| `after-10-supplement-tomorrow.png` | 补充：明天高亮与保存按钮 |
| `after-11-supplement-custom-date.png` | 补充：自选日期值、高亮与保存按钮 |

自选日期通过实际 picker 组件的 `change` 事件注入合成日期，验证事件绑定、日期值展示与高亮；未操作平台原生日期滚轮。未验证 320px 窄屏、真机、正式云或多账户。全部保存输入均停留在合成账户页面，未执行正式写入。

首次初始化曾出现空页面，样式热更期间也出现自动化超时；对应探测保存在 `before-runtime.json`、`runtime-probe.json`、`after-runtime-hot-reload-failure.json`。最终正常载入隔离工程后完成上述截图与尺寸核验。
