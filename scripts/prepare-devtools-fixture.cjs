'use strict';
// 生成独立离线验证工程，不改生产 App/配置。重新生成覆盖的仅为此脚本的产物。
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'qa', 'local', 'inspiration-workflows');
if (!target.startsWith(root + path.sep + 'qa' + path.sep + 'local' + path.sep)) throw Error('INVALID_FIXTURE_TARGET');
fs.mkdirSync(target, { recursive: true });
fs.cpSync(path.join(root, 'miniprogram'), path.join(target, 'miniprogram'), { recursive: true });
fs.copyFileSync(path.join(root, 'tests/fixtures/devtools-app.js'), path.join(target, 'miniprogram/app.js'));
const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
project.projectname = '灵感拾光簿-离线验证'; delete project.cloudfunctionRoot;
fs.writeFileSync(path.join(target, 'project.config.json'), JSON.stringify(project, null, 2));
fs.writeFileSync(path.join(target, 'miniprogram/config/cloud.js'), "module.exports = { enabled: false, envId: '', apiFunction: 'DISABLED_QA' };\n");
console.log(target);
