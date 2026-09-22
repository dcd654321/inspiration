'use strict';
// 骨架阶段的不变量守卫。这些断言是刻意的：改动它们意味着你在启用云或 AI，
// 而那需要先完成授权、部署与验收，不能靠改开关生效。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('云与 AI 开关在骨架阶段保持关闭', () => {
  const cloud = require('../miniprogram/config/cloud');
  const ai = require('../miniprogram/config/ai');
  assert.strictEqual(cloud.enabled, false, '云开关须为 false：尚未创建 linggan_* 资源，也未取得部署授权');
  assert.strictEqual(ai.enabled, false, 'AI 开关须为 false：未接入真实模型，且缺少额度与内容安全');
  assert.strictEqual(cloud.envId, '', '骨架阶段不得填写云环境 ID');
});

test('云端资源名使用本项目 linggan_ 前缀', () => {
  const resources = require('../miniprogram/config/cloud-resources');
  for (const [name, value] of Object.entries(resources)) {
    assert.ok(value.startsWith('linggan_') || value.startsWith('linggan/'),
      `${name} 必须以 linggan_ 或 linggan/ 开头，实际为 ${value}`);
  }
});

test('取值边界处于合理范围', () => {
  const { LIMITS } = require('../miniprogram/core/limits');
  assert.ok(LIMITS.textMaxLength > 0 && LIMITS.textMaxLength <= 5000);
  assert.ok(LIMITS.photoMaxBytes > 0 && LIMITS.photoMaxBytes <= 10 * 1024 * 1024);
  assert.ok(LIMITS.photosPerInspiration > 0 && LIMITS.photosPerInspiration <= 20);
  assert.strictEqual(LIMITS.heatMin, 0);
  assert.strictEqual(LIMITS.heatMax, 100);
});

test('幂等标识在连续生成下不重复', () => {
  const { createId } = require('../miniprogram/core/limits');
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) seen.add(createId('insp'));
  assert.strictEqual(seen.size, 500, 'createId 产生了重复标识，会破坏幂等语义');
  assert.ok(createId('insp').startsWith('insp_'));
});

test('小程序包与云函数中不含模型密钥', () => {
  const patterns = [
    new RegExp('s' + 'k-[A-Za-z0-9]{16,}'),
    new RegExp('AKID[A-Za-z0-9]{16,}'),
    new RegExp('SECRET' + 'KEY\\s*[:=]\\s*[\'"][^\'"]{8,}'),
    new RegExp('APP' + 'SECRET\\s*[:=]\\s*[\'"][^\'"]{8,}')
  ];
  const targets = ['miniprogram', 'cloudfunctions'];
  const hits = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      const text = fs.readFileSync(file, 'utf8');
      if (patterns.some((p) => p.test(text))) hits.push(path.relative(root, file));
    }
  }
  for (const target of targets) walk(path.join(root, target));

  assert.deepStrictEqual(hits, [], `以下文件疑似包含密钥，不得进入仓库或前端包：${hits.join(', ')}`);
});

test('app.json 注册的页面文件齐全且 tabBar 指向有效页面', () => {
  const mini = path.join(root, 'miniprogram');
  const app = JSON.parse(fs.readFileSync(path.join(mini, 'app.json'), 'utf8'));
  for (const page of app.pages) {
    for (const ext of ['js', 'json', 'wxml', 'wxss']) {
      assert.ok(fs.existsSync(path.join(mini, `${page}.${ext}`)), `缺少页面文件 ${page}.${ext}`);
    }
  }
  for (const tab of app.tabBar.list) {
    assert.ok(app.pages.includes(tab.pagePath), `tabBar 指向未注册页面 ${tab.pagePath}`);
  }
});
