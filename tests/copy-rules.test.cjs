'use strict';
// 面向用户的文案守卫。
//
// 扫描产品代码（miniprogram/ 与 cloudfunctions/）里会被使用者看到的中文措辞，命中禁用词即失败。
// 规则来源：docs/ui-design.md 第 6 节（文案基调、不口语化、合规红线）与第 7 节（开发痕迹清理）。
//
// 两条实现上的取舍：
//   1. **只扫中文词。** 代码标识符都是 ASCII，中文禁用词不可能出现在标识符里，因此不会误伤
//      （`heatMin` 之类保留字段不会被「热度」这条撞上——它们根本不是同一个字符串）。
//   2. **先剥注释再扫。** 注释是写给开发者读的，允许出现「授权」「部署」「未实现」这类词。
//      这也是唯一会把注释和产品文案区分开的办法。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const TARGETS = ['miniprogram', 'cloudfunctions'];

/**
 * 禁用词与理由。新增一条之前先想清楚：它是**产品里不该出现的**，
 * 还是只是**文档里用来解释规则的**。后者不加——`docs/` 本来就不在扫描范围内。
 */
const BANNED = [
  // —— 开发脚手架漏进产品（ui-design.md 6.1 最后一条）
  { term: '骨架', why: '开发阶段自述，使用者不该看到' },
  { term: '尚未实现', why: '开发进度，属于注释不属于产品' },
  { term: '未接入', why: '开发阶段自述，属于注释而不属于产品文案' },
  { term: '实施后', why: '开发阶段自述，属于注释而不属于产品文案' },
  { term: '提案', why: 'OpenSpec 流程用词，不该出现在产品里' },
  { term: '验收', why: '开发流程用词' },
  { term: '部署', why: '开发流程用词' },
  { term: '授权', why: '开发流程用词' },

  // —— 区分本机与云端两层存储（ui-design.md 5 节「文案要求」）
  { term: '本机存储', why: '把实现分层摊给用户；界面只说「保存」' },
  { term: '云端存储', why: '把实现分层摊给用户；界面只说「保存」' },
  { term: '本机缓存', why: '把实现分层摊给用户；界面只说「保存」' },
  { term: '待同步', why: '一次保存动作的中间态，转瞬即逝，不该渲染成常驻标记' },

  // —— 已废弃的旧措辞（ui-design.md 6.2 / 6.3）
  { term: '汇入原文', why: '已改名为「合并进灵感」' },
  { term: '去记一条', why: '太口语，已改为「新建灵感」' },
  { term: '删除这条灵感', why: '已改为「删除灵感」' },
  { term: '删除这条补充', why: '已改为「删除补充」' },
  { term: '覆盖原来的', why: '指代不清，应按上下文写成「覆盖补充」/「覆盖灵感」' },
  { term: '存一个新的', why: '同上，应为「新增补充」/「一个新灵感」' },
  { term: '删除后无法恢复', why: '已改为「此操作无法撤销」' },

  // —— 推销口吻与合规红线（ui-design.md 6.1 / 6.4）
  { term: '让 AI 帮', why: '推销口吻；且 AI 默认关闭时属不实描述' },
  { term: '不受影响', why: '把规范条款抄成界面文案，用户不关心功能矩阵' },

  // —— 已暂缓的能力（ui-design.md 与 proposal.md 非目标）
  { term: '热度', why: '热度提炼已暂缓，界面不得出现任何评分暗示' }
];

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // 块注释
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // 行注释（[^:] 避免吃掉 cloud:// 这类）
}

function collectFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { collectFiles(file, out); continue; }
    if (/\.(js|cjs|wxml|wxss|json)$/.test(entry.name)) out.push(file);
  }
  return out;
}

test('产品代码里不出现禁用措辞', () => {
  const files = [];
  for (const target of TARGETS) {
    const dir = path.join(root, target);
    if (fs.existsSync(dir)) collectFiles(dir, files);
  }
  assert.ok(files.length > 0, '没有扫描到任何产品文件，检查 TARGETS');

  const hits = [];
  for (const file of files) {
    const lines = stripComments(fs.readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, index) => {
      for (const rule of BANNED) {
        if (line.indexOf(rule.term) !== -1) {
          hits.push({
            where: `${path.relative(root, file)}:${index + 1}`,
            term: rule.term,
            why: rule.why,
            line: line.trim().slice(0, 80)
          });
        }
      }
    });
  }

  const report = hits.map((h) => `${h.where}  出现「${h.term}」——${h.why}\n      ${h.line}`);
  assert.deepStrictEqual(
    hits, [],
    `产品代码里出现了不该给使用者看到的措辞：\n  ${report.join('\n  ')}`
  );
});

test('禁用词清单自身是可审阅的', () => {
  assert.ok(BANNED.length > 0);
  for (const rule of BANNED) {
    assert.strictEqual(typeof rule.term, 'string');
    assert.ok(rule.why && rule.why.length > 4, `「${rule.term}」缺少理由——没有理由的禁用词迟早会被绕过`);
  }
});
