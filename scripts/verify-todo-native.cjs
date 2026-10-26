'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), sourceRoot = path.join(root, 'miniprogram');
const compilerRoot = process.env.WECHAT_COMPILER_ROOT || 'E:/weixinDevTool/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec';
const outputRoot = path.join(root, 'qa/local/todos-20261021/native'); fs.mkdirSync(outputRoot, { recursive: true });
const collect = (dir, extension) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? collect(file, extension) : entry.name.endsWith(extension) ? [file] : [];
}).sort();
function compile(extension, binary, filename) {
  const sources = collect(sourceRoot, extension);
  const files = sources.map(file => path.relative(sourceRoot, file).replaceAll('\\', '/'));
  const compiler = path.join(compilerRoot, binary), output = path.join(outputRoot, filename), args = ['-o', output, ...files];
  const result = spawnSync(compiler, args, { cwd: sourceRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return { compiler, args, count: files.length, exitCode: result.status,
    diagnostics: [result.error && result.error.message, result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
    outputGenerated: fs.existsSync(output) && fs.statSync(output).size > 0,
    sourceSha256: Object.fromEntries(sources.map((file, i) => [files[i], crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')])) };
}
const evidence = { date: '2026-10-21', checkedAtUtc: new Date().toISOString(), cloudCalls: false, deviceAcceptance: false,
  wxml: compile('.wxml', 'wcc.exe', 'compiled-wxml.js'), wxss: compile('.wxss', 'wcsc.exe', 'compiled-wxss.js') };
fs.writeFileSync(path.join(root, 'qa/inspiration-todos-native-20261021.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(['wxml', 'wxss'].map(key => [key, { count: evidence[key].count,
  exitCode: evidence[key].exitCode, diagnostics: evidence[key].diagnostics, outputGenerated: evidence[key].outputGenerated }])), null, 2));
if ([evidence.wxml, evidence.wxss].some(result => result.exitCode !== 0 || !result.outputGenerated)) process.exitCode = 1;
