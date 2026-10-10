'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const resources = require('../miniprogram/config/cloud-resources');
const { TARGETS } = require('../scripts/build-cloud.cjs');

function preview(argv) {
  const commands = [], output = [], exits = [];
  const filename = path.resolve(__dirname, '../scripts/deploy-cloud.cjs');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    __dirname: path.dirname(filename),
    process: { argv: ['node', filename, ...argv], execPath: 'node', env: {}, platform: 'win32', exit(code) { exits.push(code); } },
    console: { log(value) { output.push(value); }, error(value) { output.push(value); } },
    require(name) {
      if (name === 'node:child_process') return { spawnSync(...args) { commands.push(args); return { status: 0 }; } };
      if (name === 'node:path') return path;
      if (name === '../miniprogram/config/cloud-resources') return resources;
      throw Error('Unexpected module ' + name);
    }
  }, { filename });
  return { commands, output: output.join('\n'), exits };
}

test('无 AI 版本默认构建和部署仅指向两个非 AI 云函数', () => {
  assert.deepEqual(TARGETS.map((target) => target.fn), ['linggan_api', 'linggan_maintenance']);
  const result = preview(['--env', 'test', '--dry-run']);
  assert.deepEqual(result.exits, []);
  assert.equal(result.commands.length, 1);
  assert.match(result.commands[0][1][0], /build-cloud\.cjs$/);
  assert.match(result.output, /--names linggan_api linggan_maintenance --remote-npm-install/);
  assert.doesNotMatch(result.output, /linggan_ai/);
});

test('显式请求旧 AI 部署目标在构建和平台调用前被拒绝', () => {
  const result = preview(['--env', 'product', '--names', 'linggan_ai', '--dry-run']);
  assert.deepEqual(result.exits, [1]);
  assert.equal(result.commands.length, 0);
  assert.match(result.output, /未知函数：linggan_ai/);
});
