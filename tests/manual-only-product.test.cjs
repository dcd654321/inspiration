'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const core = require('../miniprogram/core/inspiration');
const { buildArchiveText, buildTemplateText } = require('../miniprogram/services/content-output');
const { validRecord } = require('../server/record-validation');

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? sources(file) : /\.(js|json|wxml)$/.test(file) ? [file] : [];
  });
}

test('无 AI 发布包：全部客户端依赖可解析且不包含模型调用或生成入口', () => {
  const files = sources(path.join(root, 'miniprogram'));
  assert.equal(require('../miniprogram/app.json').pages.length, 14);
  for (const file of files) {
    const body = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(body, /linggan_ai|LINGGAN_AI|pages\/ai-workbench|onAiExpand|onAiSummarize|require\(['"][^'"]*\/(?:ai|ai-workflow|ai-contract)['"]\)/, path.relative(root, file));
    if (!file.endsWith('.js')) continue;
    for (const match of body.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      assert.doesNotThrow(() => require.resolve(path.resolve(path.dirname(file), match[1])), file + ': ' + match[1]);
    }
  }
  for (const target of ['server', 'cloudfunctions/linggan_api', 'cloudfunctions/linggan_maintenance', 'deployment/product']) {
    for (const file of sources(path.join(root, target))) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /linggan_ai_usage|LINGGAN_AI|require\(['"]\.\/ai-(?:quota|service)['"]\)/, path.relative(root, file));
  }
});

test('无 AI 兼容：历史生成来源及修改原文保留，手工格式不改写内容', () => {
  let item = core.createInspiration({ id: 'history', text: '原始想法', now: 1 });
  item = core.appendSupplement(item, { id: 'old_ai', content: '过去生成的补充', source: 'ai', now: 2 });
  item = { ...item, textHistory: [{ id: 'h1', text: '更早的原文', replacedAt: 2 }] };
  const before = structuredClone(item);
  assert.equal(validRecord(item), true);
  const archive = buildArchiveText(item, 3);
  assert.match(archive, /过去生成的补充/); assert.match(archive, /AI 生成，请核对/);
  assert.match(archive, /更早的原文/);
  assert.match(buildTemplateText(item, ['old_ai'], 'work'), /原始想法\n\n过去生成的补充/);
  assert.deepEqual(item, before);
  const legacy = structuredClone(item);
  legacy.supplements[0].content = '历'.repeat(1500);
  legacy.supplements[0].sourceIds = ['a', 'b'];
  assert.equal(validRecord(legacy), true, '历史汇总补充保持原来的两千字契约');
  legacy.supplements[0].source = 'user';
  assert.equal(validRecord(legacy), false, '当前普通补充仍受一千字限制');
});
