# 修改记录修复验证（2026-10-11）

修复详情只统计正文历史、补充缺少查看入口，以及文字留档误用 `text` 读取补充旧文字的三个问题。保存继续使用既有 `textHistory[].text` 和 `contentHistory[].content`，本轮不迁移数据、不修改服务端或云端资源。

查看路径：详情「更多 → 修改记录」显示正文和现存补充的全部旧版本；单条补充「更多 → 修改记录」只显示该补充。已并入正文或已合并的补充仍可从展开后的操作面板查看。旧版本只读，保留内部换行，按修改时间倒序排列。

## 自动化与编译

- 定向测试 76/76；全量 `npm test` 489/489，0 失败、0 跳过，三道自动闸门通过。
- `npm run check` 296 项；OpenSpec strict 18/18；`git diff --check` 通过。
- 新增 `tests/change-history.test.cjs` 六项回归，调用实际客户端 store、协议和 repository，数据库为隔离内存适配器。验证正文连续修改、补充修改、保存后新 store 重新拉取、服务端拒绝删减历史、未知保存重试、目标缺失、读取失败重试与页面/账户迟到结果隔离。
- 留档回归使用实际 `content` 字段，验证正常及已收起补充的旧文字、内部换行和来源不变。
- 微信原生编译通过：14 WXML、15 WXSS，见 [native-compile.json](native-compile.json)。

本地命令日志位于忽略目录 `qa/local/change-history-{test,check,spec}-20261011.log`。

## 模拟器边界

隔离工程位于 `qa/local/change-history-20261011/project`，云功能关闭，App/store 与文字均为合成样例，不访问正式账户、不执行真实云写入。配置摘要见 [fixture.json](fixture.json)，运行状态见 [runtime.json](runtime.json)。

启动和切页曾出现页面栈未就绪及截图停在过渡画面；早期尝试单独保存为 `startup-attempt.json`、`navigation-attempt.json`、`render-transition-attempt.json`、`restart-attempt.json`，这些不作为渲染通过证据。

最终连接等待逻辑页面切换、原生节点出现及渲染完成后取得八张截图，逐张查看，无捕获运行异常。390×844、基础库 3.17.2。历史入口采用原生按钮 tap；补充面板打开、正文输入及并入正文使用页面方法调用，保存采用合成 store 确认。该流程不证明真实触摸、键盘或云端保存。

| 截图 | 核对内容 |
| --- | --- |
| [01 总入口](01-supplement-only-history-entry.png) | 只有补充旧版本时仍显示修改记录（1） |
| [02 全部历史](02-all-history-supplement-only.png) | 正文无旧版本时，补充当前内容与完整旧文字分组显示 |
| [03 单条补充面板](03-single-supplement-menu.png) | 单条补充有独立修改记录入口 |
| [04 单条历史](04-single-supplement-history.png) | 只显示指定补充，保留内部换行和修改时间 |
| [05 正文和补充分组](05-body-and-supplement-history.png) | 修改正文并确认后，正文与补充各有一条旧版本，总计 2 条 |
| [06 收起补充历史](06-folded-supplement-history.png) | 并入正文后仍可打开原补充旧版本 |
| [07 文字留档](07-complete-archive.png) | 面板首段可见正文及正文旧版本；补充旧文字完整性另由运行数据断言和留档回归核对 |
| [08 补充缺失](08-missing-supplement.png) | 指定补充不存在时显示缺失态，不展示其他内容 |

真机中文输入、长文与系统大字体、正式云端保存后重新打开、弱网和多账户仍待验收。所有改动留在工作区，尚未提交、推送或部署。
