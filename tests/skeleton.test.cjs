'use strict';
// 骨架阶段的不变量守卫。这些断言是刻意的：改动它们意味着你在启用云或 AI，
// 而那需要先完成授权、部署与验收，不能靠改开关生效。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('云与 AI 开关仍保持关闭', () => {
  const cloud = require('../miniprogram/config/cloud');
  const ai = require('../miniprogram/config/ai');

  assert.strictEqual(ai.enabled, false, 'AI 开关须为 false：未接入真实模型，且缺少额度与内容安全');
  assert.strictEqual(
    cloud.enabled, false,
    '云开关须为 false：资源尚未创建、函数尚未部署。翻开关前先按 docs/DEPLOYMENT.md 走完清单'
  );
});

test('云开关一旦打开，环境 ID 就不能是空的', () => {
  // 反方向的守卫。它不检查「资源是不是真的建好了」——那只能靠部署清单和验收，闸门管不到。
  // 它守的是另一件事：**别在 envId 还空着的时候翻开关**，
  // 那会让应用去调一个不存在的环境，而错误被降级提示盖住，很难查出真正原因。
  const cloud = require('../miniprogram/config/cloud');

  if (cloud.enabled) {
    assert.ok(
      typeof cloud.envId === 'string' && cloud.envId.length > 0,
      '云开关已打开，但 envId 是空的'
    );
  }
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

test('小程序名在导航栏里处处一致', () => {
  // 这道闸门是被一次真实的坑催生的：小程序改名为「灵感拾光簿」之后，
  // 三个 tab 页仍显示各自的旧标题——因为 **app.json 的窗口标题只是全局默认值**，
  // 页面在 pages/*/index.json 里设了自己的标题就会把它盖掉。
  // 改全局值不影响这些页面，而当时没有任何东西会提醒这件事。
  //
  // 规则（见 docs/ui-design.md 第 1 节）：
  //   tab 页 → 小程序名（tab 栏已经标了区块名，导航栏重复它是冗余）
  //   二级页 → 功能名（它没有 tab 标签，导航栏必须回答「我在哪」）
  const mini = path.join(root, 'miniprogram');
  const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  const app = JSON.parse(fs.readFileSync(path.join(mini, 'app.json'), 'utf8'));
  const tabPages = app.tabBar.list.map((tab) => tab.pagePath);

  function titleOf(page) {
    return JSON.parse(fs.readFileSync(path.join(mini, page + '.json'), 'utf8')).navigationBarTitleText;
  }

  assert.strictEqual(
    app.window.navigationBarTitleText, project.projectname,
    'app.json 的全局窗口标题应当是小程序名'
  );

  for (const page of tabPages) {
    assert.strictEqual(
      titleOf(page), project.projectname,
      `${page} 是 tab 页，导航栏标题应当是小程序名`
    );
  }

  for (const page of app.pages) {
    if (tabPages.includes(page)) continue;
    assert.notStrictEqual(
      titleOf(page), project.projectname,
      `${page} 是二级页，导航栏标题应当是功能名——它没有 tab 标签，必须回答「我在哪」`
    );
  }
});
