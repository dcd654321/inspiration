# AI 工作台审查证据

2026-10-02。本轮 13 张截图均已打开核对，完整步骤、观察、处理和限制见 `../../AI-EXPERIENCE-20261002.md`。

01—02：改动前的生产页面在隔离工程开放入口；03—13：优化后同工程真实 WXML/WXSS 编译渲染。App、合成账户和 AI/保存响应注入仅在 `qa/local/inspiration-workflows`，未以模拟结果替代真实平台验收。

逻辑尺寸 390×844，基础库 3.17.2。01—03、05—13 截图为 363×785；04 更新详情间距后通过官方 simulator_screenshot 重拍为 289×625（工具窗口显示缩放，逻辑宽度仍为390，不作为额外屏宽测试）。runtime-checks.json 为界面状态与按钮测量；live-readiness.json 为真实项目基础库 3.17.3 在改动前对 test 的受控调用；cloud-readiness.json 为资源方两环境元数据、索引回读及最终真实客户端开关。真实调用不记录私人正文或账户身份。

PNG 按仓库既有规则忽略，不会因提交 Markdown 自动入库；本轮未提交。截图保留在本机目录，不上传外部服务。

live-readiness.json 同时保留收尾时返回的较早延迟探测：账户可用，但调用返回 -404006（empty poll result），没有模型结果；该探测读取的是改动前客户端状态。当前客户端开关以 cloud-readiness.json.finalClientObservation 的 true 为准。
