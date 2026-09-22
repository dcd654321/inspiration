'use strict';
// 规范覆盖率闸门。见 docs/spec-coverage.md。
//
// 这里不做覆盖率统计，只做一件事：让「规范改了而没人管」和「覆盖率表写成了一厢情愿」
// 都变成红的。没有这道闸门之前，规范里 83 条场景，仓库里没有任何东西能告诉你
// 哪条有实现、哪条没有。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const changeDir = path.join(root, 'openspec/changes/add-inspiration-mvp/specs');
const coverageFile = path.join(root, 'docs/spec-coverage.md');

// 本变更范围内的规范。inspiration-heat 已暂缓、整份不在本变更内，见 docs/spec-coverage.md。
const IN_SCOPE = ['inspiration-capture', 'photo-capture', 'ai-expansion', 'ai-summarize'];

/** 只有这两种状态需要指向真实测试。 */
const COVERED_STATUSES = ['已覆盖', '部分覆盖'];

function readScenarios() {
  const out = [];
  for (const name of IN_SCOPE) {
    const lines = fs.readFileSync(path.join(changeDir, name, 'spec.md'), 'utf8').split('\n');
    let requirement = '';
    for (const line of lines) {
      const req = line.match(/^### Requirement: (.+)$/);
      if (req) { requirement = req[1].trim(); continue; }
      const scenario = line.match(/^#### Scenario: (.+)$/);
      if (scenario) out.push({ spec: name, requirement, scenario: scenario[1].trim() });
    }
  }
  return out;
}

function readCoverageRows() {
  const rows = [];
  for (const line of fs.readFileSync(coverageFile, 'utf8').split('\n')) {
    const m = line.match(
      /^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(已覆盖|部分覆盖|待验收|待实现)\s*\|\s*(.*?)\s*\|\s*$/
    );
    if (m) rows.push({ requirement: m[1], scenario: m[2], status: m[3], detail: m[4] });
  }
  return rows;
}

function readTestNames() {
  const dir = path.join(root, 'tests');
  const names = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.test.cjs') || file === 'spec-coverage.test.cjs') continue;
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of src.matchAll(/(?:^|\n)test\(['"]([^'"]+)['"]/g)) names.push(m[1]);
  }
  return names;
}

function countBy(items) {
  const map = new Map();
  items.forEach((item) => map.set(item, (map.get(item) || 0) + 1));
  return map;
}

const scenarios = readScenarios();
const rows = readCoverageRows();
const testNames = readTestNames();

test('闸门本身能读到东西', () => {
  assert.ok(scenarios.length > 0, '没有从规范里解析出任何场景，检查 spec 文件的标题格式');
  assert.ok(testNames.length > 0, '没有从 tests/ 里解析出任何测试名');
  assert.ok(rows.length > 0, '没有从 docs/spec-coverage.md 解析出任何行，检查表格格式');
});

test('覆盖率表与规范完全对齐——不多不少', () => {
  const inSpec = countBy(scenarios.map((s) => s.scenario));
  const inDoc = countBy(rows.map((r) => r.scenario));

  const missing = [];
  const stale = [];

  for (const [title, n] of inSpec) {
    const covered = inDoc.get(title) || 0;
    for (let i = 0; i < n - covered; i += 1) missing.push(title);
  }
  for (const [title, n] of inDoc) {
    const declared = inSpec.get(title) || 0;
    for (let i = 0; i < n - declared; i += 1) stale.push(title);
  }

  assert.deepStrictEqual(
    missing, [],
    `以下场景在规范里存在，但 docs/spec-coverage.md 里没有对应行。\n新增场景必须同步进覆盖率表：\n  ${missing.join('\n  ')}`
  );
  assert.deepStrictEqual(
    stale, [],
    `以下条目在覆盖率表里存在，但规范里已经没有这条场景（陈旧条目，请删除）：\n  ${stale.join('\n  ')}`
  );
});

test('标为已覆盖或部分覆盖的条目，必须指向真实存在的测试用例', () => {
  const problems = [];

  for (const row of rows) {
    if (COVERED_STATUSES.indexOf(row.status) === -1) continue;

    const cited = row.detail.match(/^「(.+?)」/);
    if (!cited) {
      problems.push(`${row.scenario}：状态是「${row.status}」，但第四列没有以「测试名」开头`);
      continue;
    }
    if (testNames.indexOf(cited[1]) === -1) {
      problems.push(`${row.scenario}：引用的测试「${cited[1]}」在 tests/ 里不存在`);
    }
  }

  assert.deepStrictEqual(
    problems, [],
    `覆盖率表指向了不存在的测试。测试改名了要同步这张表，实现没写就别标已覆盖：\n  ${problems.join('\n  ')}`
  );
});

test('标为待实现的条目必须写清缺在哪一层', () => {
  const vague = rows
    .filter((row) => row.status === '待实现' && row.detail.trim().length < 4)
    .map((row) => row.scenario);

  assert.deepStrictEqual(vague, [], `以下条目状态是「待实现」但没写明缺什么：\n  ${vague.join('\n  ')}`);
});

test('标为待验收的条目必须写清要在哪验', () => {
  // 「待验收」是页面写完但还没在开发者工具/真机上走通的状态。不写明在哪验，
  // 它就会悄悄变成「已覆盖」的同义词。
  const vague = rows
    .filter((row) => row.status === '待验收' && row.detail.trim().length < 8)
    .map((row) => row.scenario);

  assert.deepStrictEqual(vague, [], `以下条目状态是「待验收」但没写清验证方式：\n  ${vague.join('\n  ')}`);
});
