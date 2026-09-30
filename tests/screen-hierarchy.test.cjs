'use strict';
// 界面层级调整（2026-09-30）：首屏减负、详情页重排、状态提示与对齐修复。
//
// 这批改动多在 WXML/WXSS 层，Node 里测不了渲染，但**结构和守卫条件是可以断言的**：
// 比如「空数据不渲染筛选」＝ 工具区被 wx:if 包住；
// 「整理标记默认收起」＝ 表单在 wx:if="{{orgOpen}}" 里、初始值为 false。
// 渲染效果本身仍归开发者工具与真机验收。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('首屏减负：列表没有记录时不渲染搜索与筛选', () => {
  const page = read('miniprogram/pages/list/index.wxml');
  const guard = page.indexOf('wx:if="{{activeCount + mergedCount > 0}}"');
  const search = page.indexOf('class="search-box"');
  const filters = page.indexOf('class="list-filters"');
  assert.ok(guard >= 0, '缺少「有记录才渲染工具区」的守卫');
  assert.ok(search > guard, '搜索框必须在守卫之内');
  assert.ok(filters > guard, '筛选行必须在守卫之内');
  // 空态与「记下第一个想法」仍然在守卫之外，任何情况下都能开始
  assert.ok(page.indexOf('还没有记录') > guard);
  assert.match(page, /记下第一个想法/);
  // 仅剩已合并内容时不能让入口消失，也不展示真空态
  assert.match(page, /现有内容都已合并/);
  assert.match(page, /bindtap="onShowMerged"/);
});

test('列表：默认筛选行只放三个 chip，七天内/阶段/已合并进筛选面板', () => {
  const page = read('miniprogram/pages/list/index.wxml');
  const filters = page.indexOf('class="list-filters"');
  const head = page.indexOf('class="list-head"');
  assert.ok(filters >= 0 && head > filters);
  // 默认行：全部 / 有补充 / 筛选
  assert.match(page, /data-filter="all"/);
  assert.match(page, /data-filter="supplemented"/);
  assert.ok(page.indexOf('筛选{{panelCount') > filters, '筛选 chip 应在默认行内');
  // 面板内承载三个高级条件
  const panel = page.indexOf('class="sheet"');
  assert.ok(panel >= 0);
  assert.ok(page.indexOf('bindtap="onToggleRecent"') > panel, '七天内应在面板内');
  assert.ok(page.indexOf('bindchange="onStageFilter"') > panel, '阶段应在面板内');
  assert.ok(page.indexOf('bindtap="onToggleMerged"') > panel, '已合并应在面板内');
  assert.match(page, /bindtap="onResetPanel">重置筛选</);
  // 选材整理与汇总属于整份列表，放在段落头
  assert.ok(page.indexOf('选材整理') > head);
  assert.ok(page.indexOf('汇总多条灵感') > head);
});

test('列表：搜索框清空只清搜索词，全局清空在无结果态', () => {
  const page = read('miniprogram/pages/list/index.wxml');
  assert.match(page, /bindtap="onClearQuery">清空搜索</);
  assert.match(page, /bindtap="onClearAll">清空搜索和筛选</);
  const logic = read('miniprogram/pages/list/index.js');
  // 清空搜索不清筛选条件
  const clearQuery = logic.slice(logic.indexOf('onClearQuery'));
  assert.ok(clearQuery.indexOf('query: \'\'') < clearQuery.indexOf('}'));
  assert.doesNotMatch(clearQuery.slice(0, 200), /filter: 'all'/);
  // 账户变化清空查询、筛选与阅读位置
  assert.match(logic, /resetViewState/);
  assert.match(logic, /scope !== this\.scope/);
});

test('列表：回顾行串在第一条记录之后，展开才有内容与动作', () => {
  const page = read('miniprogram/pages/list/index.wxml');
  const rowLoop = page.indexOf('class="list"');
  assert.ok(rowLoop >= 0);
  const review = page.indexOf('index === 0 && reviewItem');
  assert.ok(review > rowLoop, '回顾行应在列表容器内、第一条记录之后');
  assert.match(page, /回看一个想法/);
  assert.match(page, /bindtap="onDismissReview">本次先不看</);
  // 展开前不出现内容与动作
  const expanded = page.indexOf('wx:if="{{reviewExpanded}}"');
  assert.ok(expanded > review);
  assert.ok(page.indexOf('继续补充') > expanded);
});

test('列表：行内不再重复「查看」按钮，阶段与标签只在非默认时出现', () => {
  const page = read('miniprogram/pages/list/index.wxml');
  assert.doesNotMatch(page, /class="row-enter"/);
  const logic = read('miniprogram/pages/list/index.js');
  assert.match(logic, /stageLabel: merged \? '已合并' : \(stage\.id === STAGES\[0\]\.id \? '' : stage\.label\)/);
  assert.match(logic, /tagMore/);
  // 已合并计数与有效计数分开算：真空态只认两者都为 0
  assert.match(logic, /mergedCount = snapshot\.inspirations\.filter/);
});

test('对齐修复：小程序 button 的默认宽度与左右外边距被统一复位', () => {
  const styles = read('miniprogram/app.wxss');
  // 单类选择器盖不住 button 默认样式，必须两层选择器
  assert.match(styles, /\.page button,[\s\S]*?width:\s*auto;/);
  assert.match(styles, /margin-left:\s*0;[\s\S]*?margin-right:\s*0;/);
  // 44 逻辑px 热区兜底：320 宽时 88rpx 只有约 37.5px
  assert.match(styles, /min-height:\s*max\(88rpx,\s*44px\);/);
  assert.match(styles, /min-width:\s*max\(88rpx,\s*44px\);/);
  // 整宽按钮同样要两层，否则欢迎页这种不在 .page 里的页面会退化成并排
  assert.match(styles, /\.btn\.btn-block\s*\{[\s\S]*?width:\s*100%;/);
});

test('操作面板：说明文字另起一行，不用 flex 把主标签挤成逐字换行', () => {
  const styles = read('miniprogram/app.wxss');
  const item = styles.slice(styles.indexOf('.sheet .sheet-item'), styles.indexOf('.sheet-item .sub'));
  assert.doesNotMatch(item, /justify-content:\s*space-between/, '主标签与说明不能并排抢宽度');
  const sub = styles.slice(styles.indexOf('.sheet-item .sub'));
  assert.match(sub, /display:\s*block/, '说明必须自成一行');
  // 面板与确认框是全站共用组件，不许各页各写一份
  const detail = read('miniprogram/pages/detail/index.wxss');
  assert.doesNotMatch(detail, /^\.mask\s*\{/m);
  assert.doesNotMatch(detail, /^\.sheet\s*\{/m);
});

test('可编辑字段的输入边界：标签与阶段不能再长得像说明文字', () => {
  const styles = read('miniprogram/pages/detail/index.wxss');
  assert.match(styles, /\.organization input,[\s\S]*?border:\s*2rpx solid var\(--line-strong\);/);
});

test('状态提示：成功、警示、失败用三种不同的图标形状', () => {
  const styles = read('miniprogram/app.wxss');
  assert.match(styles, /\.notice-warn \.mark::before/, '警示缺少图标');
  assert.match(styles, /\.notice-err \.mark::before,[\s\S]*?\.notice-err \.mark::after/, '失败缺少图标');
  assert.match(styles, /\.notice-success \.mark::after/, '成功缺少图标');
  // 成功不再用点睛色，避免读起来像警告
  const success = styles.slice(styles.indexOf('.notice-success {'));
  assert.match(success, /background:\s*var\(--brand-soft\)/);
  assert.doesNotMatch(success.slice(0, 200), /spark/);
});

test('反馈页：字数不够时提交按钮不可点，并写明还差几字', () => {
  const page = read('miniprogram/pages/feedback/index.wxml');
  const logic = read('miniprogram/pages/feedback/index.js');
  assert.match(page, /disabled="\{\{busy \|\| !canSubmit\}\}"/);
  assert.match(page, /还需 /);
  assert.match(logic, /canSubmit:\s*trimmedLength\s*>=\s*10/);
});

test('写了一半被打断：输入非空时离开页面给出提示，但不做本机暂存', () => {
  const capture = read('miniprogram/pages/capture/index.js');
  assert.match(capture, /enableAlertBeforeUnload/);
  assert.match(capture, /disableAlertBeforeUnload/);
  // 只在可编辑且未提交时打开离开提示；提交中与结果未知时不叠加
  assert.match(capture, /canEdit = value\.trim\(\)\.length > 0 && overBy === 0/);
  assert.match(capture, /guardDraft\(canEdit\)/);
  assert.match(capture, /guardDraft\(false\)/);
  const detail = read('miniprogram/pages/detail/index.js');
  assert.match(detail, /guardDraft\(canEdit\)/);
  // 仍然不落盘
  assert.doesNotMatch(capture, /setStorage|saveFile/);
  assert.doesNotMatch(detail, /setStorage|saveFile/);
});

test('修改记录：没有历史时说明原因并给一条回去的路', () => {
  const page = read('miniprogram/pages/history/index.wxml');
  const logic = read('miniprogram/pages/history/index.js');
  assert.match(page, /还没有修改记录/);
  assert.match(page, /正文还没有改过。修改后，旧内容会保留在这里。/);
  assert.match(page, /bindtap="onBack">返回这条灵感</);
  assert.match(logic, /onBack\(\)/);
  // 读取失败与确认缺失分开：网络问题不能说成「已删除」
  assert.match(page, /暂时无法读取灵感/);
  assert.match(page, /找不到这条灵感/);
  assert.match(logic, /readError/);
  // 只读承诺不变：没有编辑或删除入口
  assert.doesNotMatch(page, /bindtap="onEdit|bindtap="onDelete/);
});

test('照片查看：只有一张时不提示左右滑动；失败给重试而不是「文件已删除」', () => {
  const page = read('miniprogram/pages/photo-viewer/index.wxml');
  assert.match(page, /photos\.length > 1 \? ' · 左右滑动查看' : ''/);
  assert.match(page, /bindtap="onReload">重新加载照片</);
  const logic = read('miniprogram/pages/photo-viewer/index.js');
  assert.match(logic, /照片未加载/);
  assert.doesNotMatch(logic, /文件可能已被删除/);
});

test('详情页：整理标记默认收起，摘要行始终写着当前状态', () => {
  const page = read('miniprogram/pages/detail/index.wxml');
  const logic = read('miniprogram/pages/detail/index.js');
  assert.match(logic, /orgOpen:\s*false/, '整理标记必须默认收起');
  assert.match(logic, /orgSummary:/, '收起后仍要有摘要');
  assert.match(logic, /未加标签/, '没有标签时摘要也要说清');
  assert.match(page, /wx:if="\{\{orgOpen\}\}"/, '表单只在展开时渲染');
  assert.match(page, /bindtap="onToggleOrganization"/);
  // 输入框与阶段选择必须在展开块之内
  const open = page.indexOf('wx:if="{{orgOpen}}"');
  assert.ok(page.indexOf('bindinput="onTagsInput"') > open, '标签输入应在展开块内');
  assert.ok(page.indexOf('bindchange="onStageSelect"') > open, '阶段选择应在展开块内');
});

test('详情页：整理标记保存成功后收起', () => {
  const logic = read('miniprogram/pages/detail/index.js');
  assert.match(logic, /orgOpen:\s*result\.ok\s*\?\s*false/);
});

test('详情页：动作按钮等宽成行，不再出现落单的半个按钮', () => {
  const page = read('miniprogram/pages/detail/index.wxml');
  const styles = read('miniprogram/pages/detail/index.wxss');
  assert.doesNotMatch(styles, /\.output-acts \.btn\s*\{[\s\S]*?calc\(50%/, '不应再用固定两列');
  assert.match(styles, /\.output-acts \.btn\s*\{[\s\S]*?flex:\s*1 1 0;/);
  assert.match(styles, /\.detail-actions \.btn\s*\{[\s\S]*?flex:\s*1 1 0;/);
  // AI 按钮单独一行：数量与「整理/补充」不同，混在一行必然落单
  assert.match(page, /class="output-acts output-acts-ai"/);
  assert.match(styles, /\.output-acts-ai\s*\{/);
});

test('记录页与我的页文案：不列功能清单，不写辩解句', () => {
  const capture = read('miniprogram/pages/capture/index.wxml');
  assert.match(capture, /先写下来，之后再补充。/);
  assert.doesNotMatch(capture, /点子、计划和问题/);
  const mine = read('miniprogram/pages/mine/index.wxml');
  assert.doesNotMatch(mine, /不代表已发送给谁|不展示任何人的私人记录/);
  const welcome = read('miniprogram/pages/welcome/index.wxml');
  assert.doesNotMatch(welcome, /私人记录/);
});

// ---------------------------------------------------------------- 2026-09-30 第二轮（UX-HANDOFF）

test('记录页：结果未知与确认被拒绝分开，成功卡带摘录与两条下一步', () => {
  const page = read('miniprogram/pages/capture/index.wxml');
  const logic = read('miniprogram/pages/capture/index.js');
  // 结果未知：标题 + 重试/复制两条路，输入保留
  assert.match(page, /尚未确认保存/);
  assert.match(page, /内容还在输入框中。退出前请重试保存或复制内容。/);
  assert.match(page, /bindtap="onRetrySave">重试保存</);
  assert.match(page, /bindtap="onCopyDraft">复制内容</);
  // 确认被拒绝：可用确定回执说明原因，不编造
  assert.match(page, /未能保存/);
  assert.match(logic, /UNKNOWN_CODES = \['NETWORK', 'INTERNAL'\]/);
  assert.match(logic, /status: 'rejected'/);
  // 成功卡：内容摘录 + 继续补充 / 再记一条
  assert.match(page, /已记下/);
  assert.match(page, /class="saved-quote">\{\{lastSavedExcerpt\}\}/);
  assert.match(page, /bindtap="onContinueSupplement">继续补充</);
  assert.match(page, /bindtap="onRecordAnother">再记一条</);
  // 摘录两行封顶
  const styles = read('miniprogram/pages/capture/index.wxss');
  assert.match(styles, /\.saved-quote[\s\S]*?-webkit-line-clamp:\s*2/);
  // 未保存提示只在可编辑且未提交时出现
  assert.match(page, /尚未保存，退出后可能丢失。/);
  // 空输入不放示例行（2026-09-30 用户决定去掉），引导由占位符承担
  assert.doesNotMatch(page, /editor-example|例如：把周末散步路线/);
});

test('详情页：顺序为 更多 → 原文 → 轻量动作 → 补充输入 → 时间线 → 标记 → 照片', () => {
  const page = read('miniprogram/pages/detail/index.wxml');
  const head = page.indexOf('class="detail-head"');
  const origin = page.indexOf('class="origin"');
  const actions = page.indexOf('class="detail-actions"');
  const compose = page.indexOf('class="compose"');
  const timeline = page.indexOf('class="timeline"');
  const org = page.indexOf('class="organization"');
  const photos = page.indexOf('class="photos-section"');
  assert.ok(head >= 0 && origin > head, '更多入口应在原文之前');
  assert.ok(actions > origin, '轻量动作应在原文之后');
  assert.ok(compose > actions, '补充输入应在动作之后');
  assert.ok(timeline > compose, '时间线应在补充输入之后');
  assert.ok(org > timeline, '标签与阶段应在时间线之后');
  assert.ok(photos > org, '照片应在标签行之后');
  // 低频操作全部收进「更多」面板
  const morePanel = page.indexOf('class="sheet-title">这条灵感');
  assert.ok(morePanel >= 0, '缺少页内「更多」面板');
  for (const item of ['onMoreEditText', 'onMoreCopy', 'onMoreShare', 'onMoreDelete']) {
    assert.ok(page.indexOf(item) > morePanel, `${item} 应在「更多」面板内`);
  }
  // 删除灵感不再有常驻页底按钮
  assert.doesNotMatch(page, /btn-danger btn-block" bindtap="onDelete"/);
});

test('详情页：补充输入两档高度且不用 auto-height，长文有浮动定位入口', () => {
  const page = read('miniprogram/pages/detail/index.wxml');
  const styles = read('miniprogram/pages/detail/index.wxss');
  const compose = page.slice(page.indexOf('class="compose-editor'), page.indexOf('class="compose-editor') + 480);
  assert.doesNotMatch(compose, /auto-height/, '固定高度与自动增高不能同时依赖');
  assert.match(page, /composeFocus \|\| supplementDraft/);
  assert.match(styles, /\.compose-editor\.compose-tall[\s\S]*?max\(320rpx,\s*160px\)/);
  assert.match(styles, /\.compose-editor \{[\s\S]*?max\(128rpx,\s*64px\)/);
  // 长文浮动按钮：只在长正文、滚离原文、且键盘未打开时出现
  assert.match(page, /wx:if="\{\{floatVisible\}\}"[\s\S]*?继续补充/);
  const logic = read('miniprogram/pages/detail/index.js');
  assert.match(logic, /measureLongText/);
  assert.match(logic, /height > 6 \* lineHeight/);
  assert.match(logic, /event\.scrollTop > \(this\.originBottom \|\| 0\) && !this\.data\.composeFocus/);
});

test('详情页：补充菜单与确认弹窗使用定稿动作名，摘录有行数上限', () => {
  const page = read('miniprogram/pages/detail/index.wxml');
  assert.match(page, />复制补充</);
  assert.match(page, />修改补充</);
  assert.match(page, />并入正文</);
  assert.match(page, />删除补充</);
  assert.match(page, />恢复为补充</);
  // 删除确认：对象、损失、不可撤销都在框里，内容与时间独立展示
  assert.match(page, /class="dialog-quote"/);
  const logic = read('miniprogram/pages/detail/index.js');
  assert.match(logic, /confirmKind/);
  assert.match(logic, /确定删除这条灵感吗？正文、补充和照片会一并删除。/);
  assert.match(logic, /确定删除这条补充吗？/);
  const styles = read('miniprogram/app.wxss');
  assert.match(styles, /\.dialog-quote-t[\s\S]*?-webkit-line-clamp:\s*4/);
  // 标记表单：保存标记 / 取消，取消恢复进入前的值
  assert.match(page, /bindtap="onCancelOrganization"[^>]*>取消</);
  assert.match(page, /保存标记/);
});

test('详情页：读取失败与确认缺失分开，都给出可执行的返回', () => {
  const page = read('miniprogram/pages/detail/index.wxml');
  const logic = read('miniprogram/pages/detail/index.js');
  assert.ok(page.indexOf('暂时无法读取灵感') < page.indexOf('找不到这条灵感'));
  assert.match(page, /bindtap="onRetryLoad">重新读取</);
  assert.match(page, /它可能已被删除，可以返回列表查找其他记录。/);
  assert.match(page, /bindtap="onBackToList">返回灵感列表</);
  assert.match(logic, /loadError: true/);
  assert.match(logic, /wx\.switchTab\(\{ url: '\/pages\/list\/index' \}\)/);
});

test('整理成稿：进入即有稿件，工具行为 调整内容/选择格式/更多', () => {
  const page = read('miniprogram/pages/output/index.wxml');
  const logic = read('miniprogram/pages/output/index.js');
  assert.match(page, /class="output-summary">\{\{summary\}\}/);
  assert.match(page, /bindtap="onOpenContent"[^>]*>调整内容</);
  assert.match(page, /bindtap="onOpenFormat"[^>]*>选择格式</);
  assert.match(page, /bindtap="onOpenMore"[^>]*>更多</);
  assert.match(page, /bindtap="onOpenArchive">文字留档</);
  assert.match(page, /bindtap="onCopyDraft"[^>]*>复制稿件</);
  assert.match(page, /另存为新灵感/);
  // 进入即构建自由稿，补充默认全选
  assert.match(logic, /buildTemplateText\(item, selectedIds, this\.data\.templateId\)/);
  assert.match(logic, /selected: true/);
  assert.match(logic, /summary: selectedIds\.length \? '正文 \+ ' \+ selectedIds\.length \+ '条补充' : '正文'/);
  // 替换保护：只改过才确认，取消保留文字与面板
  assert.match(logic, /替换当前稿件？/);
  assert.match(logic, /你修改过这份稿件。替换后，这些修改不会保留。/);
  assert.match(logic, /confirmText: '替换稿件'/);
  assert.match(logic, /cancelText: '保留编辑'/);
  assert.match(page, /bindtap="onApply"[^>]*>应用选择</);
  assert.match(page, /bindtap="onApply"[^>]*>应用格式</);
  // 超限只禁另存，不禁复制
  assert.match(logic, /另存最多' \+ LIMITS\.textMaxLength \+ '字符，当前超出'/);
  assert.match(page, /canSaveAs/);
  // 已另存后按钮改为「已另存」，重复点击不新增
  assert.match(page, /savedSame \? '已另存' : '另存为新灵感'/);
  assert.match(logic, /这份稿件已另存，可以直接查看。/);
  assert.match(logic, /已另存为新灵感/);
  assert.match(page, /bindtap="onOpenSaved">查看新灵感</);
});

test('分享预览：同一主按钮按状态替换，制作海报为次入口', () => {
  const page = read('miniprogram/pages/share-preview/index.wxml');
  assert.match(page, /确认内容并准备分享/);
  assert.match(page, /准备中…/);
  assert.match(page, /open-type="share">选择微信好友</);
  assert.match(page, /制作海报/);
  assert.match(page, /重新制作海报/);
  assert.doesNotMatch(page, /一键发朋友圈/);
  // 修改选择使已准备结果失效
  const logic = read('miniprogram/pages/share-preview/index.js');
  assert.match(logic, /chatPrepared: false/);
  assert.match(logic, /canRetryPoster: false/);
});

test('分享页与我的分享：失效不推断原因，空态有入口', () => {
  const shared = read('miniprogram/pages/shared/index.js');
  assert.match(shared, /分享已失效，可请分享者重新发送。/);
  assert.match(shared, /请检查网络后重试。/);
  assert.match(shared, /请稍后重试。/);
  const sharedPage = read('miniprogram/pages/shared/index.wxml');
  assert.match(sharedPage, /bindtap="onRetry">重新读取</);
  assert.strictEqual((sharedPage.match(/记录我的想法/g) || []).length, 2);
  const myShares = read('miniprogram/pages/my-shares/index.wxml');
  assert.match(myShares, /还没有分享记录/);
  assert.match(myShares, /bindtap="onOpenList">查看我的灵感</);
});

test('我的页：开发者向的「使用帮助」组已删除，回顾控制只留在列表内', () => {
  const page = read('miniprogram/pages/mine/index.wxml');
  assert.match(page, /数据与隐私/);
  assert.match(page, /open-type="feedback">提交反馈</);
  // 「显示回顾入口」开关与会话统计（诊断信息）按用户 2026-09-30 决定删除
  assert.doesNotMatch(page, /使用帮助|显示回顾入口|诊断信息|使用统计/);
  const logic = read('miniprogram/pages/mine/index.js');
  assert.doesNotMatch(logic, /onReviewSetting|onUsageSetting|onCopyUsage/);
  // 回顾的会话内控制保留在列表里的「本次先不看」
  const list = read('miniprogram/pages/list/index.wxml');
  assert.match(list, /本次先不看/);
})

test('AI 页：关闭时只给一句事实和返回列表，不写开发进度', () => {
  const page = read('miniprogram/pages/ai-workbench/index.wxml');
  assert.match(page, /暂时无法使用此功能/);
  assert.match(page, /bindtap="onBackToList">返回灵感列表</);
  assert.doesNotMatch(page, /尚未开放/);
  const logic = read('miniprogram/pages/ai-workbench/index.js');
  assert.match(logic, /switchTab/);
});

test('字号下限：正文与辅助类文字在窄屏不被缩到读不出', () => {
  const styles = read('miniprogram/app.wxss');
  assert.match(styles, /font-size:\s*max\(30rpx,\s*16px\)/, '正文缺 16px 下限');
  assert.match(styles, /font-size:\s*max\(26rpx,\s*13px\)/, '辅助缺 13px 下限');
  const list = read('miniprogram/pages/list/index.wxss');
  assert.match(list, /font-size:\s*max\(25rpx,\s*14px\)/);
});

test('定稿文案回归：列表区头「最近更新」与「撤销链接」弹窗', () => {
  // C25：列表区有对外的名字，不再只有一句计数
  const list = read('miniprogram/pages/list/index.wxml');
  assert.match(list, /<text class="k">最近更新<\/text>/);
  assert.match(list, /<text class="v">共 \{\{items\.length\}\} 条<\/text>/);
  // C69：撤销确认说清对象、损失与不收回的边界，两个按钮都不是含糊的「撤销」
  const myShares = read('miniprogram/pages/my-shares/index.js');
  assert.match(myShares, /title: '撤销链接？'/);
  assert.match(myShares, /撤销后，其他人无法再通过这个链接查看内容。已复制的文字和已保存的海报不会被收回。/);
  assert.match(myShares, /confirmText: '撤销链接'/);
  assert.match(myShares, /cancelText: '保留链接'/);
});
