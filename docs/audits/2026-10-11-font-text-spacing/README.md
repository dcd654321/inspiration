# 筛选字号与文字间距验证（2026-10-11）

列表顶部两行筛选的字号使用 `max(24rpx, 12px)`，常规字重 400、选中项 500。并入正文、单条整理和跨记录选材在片段之间只插入一个换行；拼接边界已有的连续换行会清除，片段内部段落、来源文字与历史保持完整。

## 模拟器

独立工程为 `qa/local/font-text-spacing-20261011/project/`，复制本轮源码，App 使用 `tests/fixtures/devtools-app.js` 的合成内存 store，云开关关闭，无云函数目录。基础库 3.17.2，窗口 390×844，未访问正式账户数据。

[runtime.json](runtime.json) 的最终结果为通过，5 张截图已查看。八个筛选按钮实测字号均为 12px；常规字重 400、选中项 500；点击高度均为 47px，横向范围为 20—370px，没有超出窗口。实际点击有补充、整理中、七天内和重置，列表即时更新，重置恢复默认条件。

- [默认筛选](01-default-top-filters.png)
- [有补充](02-supplemented-immediate.png)
- [叠加阶段](03-stage-immediate.png)
- [叠加时间](04-time-and-stage.png)
- [重置](05-reset.png)

初次运行受沙箱限制，CLI 无法写自身状态文件；正常权限启动后，第一次截图遇到启动页导航未结束。等待启动页跳转后，实测发现微信 `button[size="mini"]` 默认字号覆盖了单类样式，显示为 16px；最终将字号放在两层选择器中覆盖默认值，并重新编译、运行全量测试及完成上述截图验证。失败记录分别保留在 `cli-wrapper-failure.json`、`launch-transition-attempt.json` 和 `default-size-attempt.json`；[修正前的字号](00-before-size-override.png) 仅用于记录该覆盖问题。

## 自动化与编译

- `npm test`：483/483，无失败、跳过；新增三项回归验证并入正文、整理成稿及选材成稿的单换行边界、内部段落和来源不变。既有页面、历史与超限回归同步核对最终结果。
- `npm run check`：288 项通过。
- OpenSpec strict：17/17，通过；沙箱 realpath EPERM 后在正常权限环境重跑。
- [native-compile.json](native-compile.json)：微信原生编译器成功编译 14 份 WXML、15 份 WXSS。
- `node scripts/build-cloud.cjs` 已执行；`--check` 确认两个云函数副本与源码一致。

文字拼接在自动化中验证；本轮模拟器截图与操作覆盖列表筛选。真机、大字体、实际云端保存与真实剪贴板仍待验收。改动尚未提交、推送或部署。
