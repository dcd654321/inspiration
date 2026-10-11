# 详情照片与标签修复验证（2026-10-10）

## 本地复核

- 照片区原来位于补充时间线和标签之后；原缩略图没有 binderror，原私有读取器在作用域条件缺失时返回空数组，可能使照片展示区没有对应占位。
- 原 onTagsInput 只改 tagsDraft；orgSummary 仍是旧记录标签。照片 addPhotos 完成后调用 load，又使用旧记录标签覆盖表单，未保存标签可能消失。
- 当前照片区在正文动作之后以单行横向缩略图展示；图片失败保留占位可重试。列表显示照片数量。标签输入同步摘要并标示尚未保存，普通重读保留表单，取消恢复原值，确认保存后显示记录里的标签。
- Node 回归使用真实页面方法与 createCloudOnlyStore，传输和照片下载为合成响应。8个新用例覆盖标签输入/取消、照片及补充重读保留草稿、确认后重入、校验及未知保存、旧回执隔离、图片失败/重试及列表只显示数量。
- 全量 npm test 477/477，npm run check 278项，严格 OpenSpec 17/17。普通沙箱 OpenSpec realpath 报 EPERM，正常权限环境重跑通过。

## 原生编译与模拟器限制

- [native-compile.json](native-compile.json)：使用微信开发者工具自带 wcc/wcsc，14 WXML、15 WXSS 编译通过。
- [flows.json](flows.json) 与 [startup-check.json](startup-check.json)：9426自动化连接成功，隔离合成App已有内存store，但 getCurrentPages() 为空；reLaunch/getPageMetaByWebviewId返回页面元数据错误。没有取得有效截图，不能报告渲染通过。
- 隔离工程 `qa/local/detail-photo-tags-20261010` 关闭云调用，替换App/store及照片下载器。图片使用包内品牌图作合成占位，无真实照片或云端写入。准备及验证脚本位于 `qa/local/detail-photo-tags-*-20261010.cjs`，均不进入发布包。

## 待验收

真机选图、实际上传及私有下载、缩略图横向滚动与大图查看、不同屏宽/字体、相机相册权限、弱网和多账户仍需验收。本轮未部署、修改存储规则、操作正式账户记录、提交或推送。
