'use strict';
// 把仓库根的源码同步进云函数目录。
//
// 微信云函数部署时**只上传函数目录本身**，所以云函数要用的共享代码必须有一份副本
// 躺在自己的目录里。这个脚本负责生成那些副本。
//
// 危险在于：源码改了、忘了同步，本地测试全过、线上跑的是旧代码。这种错很难发现，
// 因为两边都能跑。所以 `npm run check` 会调用 verify() 核对两边一致——
// **不同步即视为失败**，不靠人记得。
//
// 同步清单（`from` 相对仓库根，`to` 相对云函数目录）：
//
// | 云函数 | 同步什么 | 为什么 |
// | --- | --- | --- |
// | `linggan_api` | `server/` | 协议与仓库层的唯一来源 |
// | `linggan_ai` | `server/`、`miniprogram/core/` | 契约与内容安全的规则必须与客户端**完全一致** |
//
// `linggan_ai` 同步 `core/` 而不是自己重写一套校验规则：两边规则一旦分叉，
// 「客户端认为安全、服务端认为不安全」这种事就会出现，而它极难排查。
// `core/` 是纯函数、零 wx 依赖，放进云函数能直接跑。
//
// 用法：
//   node scripts/build-cloud.cjs          同步
//   node scripts/build-cloud.cjs --check  只核对，不改动

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const CLOUD_ROOT = path.join(root, 'cloudfunctions');

const TARGETS = [
  { fn: 'linggan_api', copies: [{ from: 'server', to: 'server' }] },
  { fn: 'linggan_ai', copies: [{ from: 'server', to: 'server' }, { from: 'miniprogram/core', to: 'core' }] }
];

/** 递归列出目录下的文件（相对路径，用 / 分隔）。 */
function listFiles(dir, base) {
  const prefix = base === undefined ? '' : base;
  if (!fs.existsSync(dir)) return [];

  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) out.push.apply(out, listFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

function removeDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) removeDir(target);
    else fs.unlinkSync(target);
  }
  fs.rmdirSync(dir);
}

function destOf(target, copy) {
  return path.join(CLOUD_ROOT, target.fn, copy.to);
}

/** 同步全部目标。先清空目标目录，避免源里删掉的文件留在副本里。 */
function sync() {
  let count = 0;
  for (const target of TARGETS) {
    for (const copy of target.copies) {
      const from = path.join(root, copy.from);
      const to = destOf(target, copy);
      removeDir(to);
      for (const rel of listFiles(from)) {
        const dest = path.join(to, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(from, rel), dest);
        count += 1;
      }
    }
  }
  return count;
}

/**
 * 核对所有副本与源码一致。
 *
 * 三类问题分开报——「少了一个文件」「多了一个文件」「内容不一样」是三种不同的错，
 * 混成一句「不一致」等于没说。多出来的文件尤其要注意：它是源里已经删掉、
 * 副本里还留着的**过期代码**，本地测试看不见它，线上却可能被 require 到。
 */
function verify() {
  const problems = [];

  for (const target of TARGETS) {
    for (const copy of target.copies) {
      const from = path.join(root, copy.from);
      const to = destOf(target, copy);
      const label = target.fn + '/' + copy.to;

      const srcFiles = listFiles(from);
      const destFiles = listFiles(to);

      for (const rel of srcFiles) {
        if (destFiles.indexOf(rel) === -1) {
          problems.push({ kind: 'missing', where: label + '/' + rel });
          continue;
        }
        const a = fs.readFileSync(path.join(from, rel), 'utf8');
        const b = fs.readFileSync(path.join(to, rel), 'utf8');
        if (a !== b) problems.push({ kind: 'different', where: label + '/' + rel });
      }

      for (const rel of destFiles) {
        if (srcFiles.indexOf(rel) === -1) problems.push({ kind: 'extra', where: label + '/' + rel });
      }
    }
  }

  return { ok: problems.length === 0, problems };
}

if (require.main === module) {
  if (process.argv.indexOf('--check') !== -1) {
    const result = verify();
    if (result.ok) {
      console.log('PASS 云函数副本与源码一致。');
    } else {
      console.error('FAIL 云函数副本与源码不一致，运行 `node scripts/build-cloud.cjs` 同步：');
      for (const p of result.problems) {
        const label = { missing: '副本缺少', extra: '副本多出（源里已删）', different: '内容不同' }[p.kind];
        console.error('  ' + label + '：' + p.where);
      }
      process.exit(1);
    }
  } else {
    const count = sync();
    console.log('已同步 ' + count + ' 个文件进云函数目录。');
  }
}

module.exports = { sync, verify, listFiles, TARGETS, CLOUD_ROOT };
