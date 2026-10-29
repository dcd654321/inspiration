'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), source = path.join(root, 'miniprogram');
const compilerRoot = process.env.WECHAT_COMPILER_ROOT || 'E:/weixinDevTool/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec';
const output = path.join(root, 'qa/local/clear-page-20261028/native');
fs.mkdirSync(output, { recursive: true });
const collect = (dir, ext) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const name = path.join(dir, entry.name);
  return entry.isDirectory() ? collect(name, ext) : entry.name.endsWith(ext) ? [name] : [];
}).sort();
function compile(ext, binary) {
  const sources = collect(source, ext), files = sources.map(file => path.relative(source, file).replaceAll('\\', '/'));
  const target = path.join(output, 'compiled-' + ext.slice(1) + '.js');
  const result = spawnSync(path.join(compilerRoot, binary), ['-o', target, ...files], {
    cwd: source, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024
  });
  return { count: files.length, exitCode: result.status,
    diagnostics: [result.error && result.error.message, result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
    outputGenerated: fs.existsSync(target) && fs.statSync(target).size > 0,
    sourceSha256: Object.fromEntries(sources.map((file, i) => [files[i], crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')])) };
}
const report = { date: '2026-10-28', checkedAtUtc: new Date().toISOString(), cloudCalls: false, deviceAcceptance: false,
  wxml: compile('.wxml', 'wcc.exe'), wxss: compile('.wxss', 'wcsc.exe') };
fs.writeFileSync(path.join(root, 'qa/clear-page-native-20261028.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(['wxml', 'wxss'].map(key => [key, {
  count: report[key].count, exitCode: report[key].exitCode, outputGenerated: report[key].outputGenerated,
  diagnostics: report[key].diagnostics
}])), null, 2));
if ([report.wxml, report.wxss].some(result => result.exitCode !== 0 || !result.outputGenerated)) process.exitCode = 1;
