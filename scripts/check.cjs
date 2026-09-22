'use strict';
// 结构性检查：JSON 可解析、JS/CJS 可编译、页面文件齐全、tabBar 指向有效页面。
// 不做 WXML/WXSS 真实编译，也不代替真机验收。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
let checks = 0;

function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'qa', '.agents'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { visit(file); continue; }
    if (entry.name.endsWith('.json')) {
      JSON.parse(fs.readFileSync(file, 'utf8'));
      checks += 1;
    }
    if (/\.(js|cjs)$/.test(entry.name)) {
      new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
      checks += 1;
    }
  }
}
visit(root);

const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
const mini = path.join(root, config.miniprogramRoot);
const app = JSON.parse(fs.readFileSync(path.join(mini, 'app.json'), 'utf8'));

for (const page of app.pages) {
  for (const ext of ['js', 'json', 'wxml']) {
    if (!fs.existsSync(path.join(mini, page + '.' + ext))) {
      throw Error('Missing page file: ' + page + '.' + ext);
    }
    checks += 1;
  }
}

for (const tab of app.tabBar.list) {
  if (!app.pages.includes(tab.pagePath)) throw Error('Unknown tab: ' + tab.pagePath);
  checks += 1;
}

// 云函数目录必须在 project.config.json 的 cloudfunctionRoot 下且含有入口。
const cloudRoot = path.join(root, config.cloudfunctionRoot);
if (!fs.existsSync(path.join(cloudRoot, 'linggan_api', 'index.js'))) {
  throw Error('Missing cloud function entry: linggan_api/index.js');
}
checks += 1;

console.log(`PASS ${checks} syntax/config/page checks. WXML compilation and native rendering require WeChat DevTools.`);
