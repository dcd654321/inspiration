'use strict';
// 把 cloudfunctions/ 下的函数部署到指定云环境——日常开发和发布走同一条链路，
// 区别只在 --env 传哪个环境。避免"手点在控制台里传错环境/漏传函数"。
//
// 用法：
//   npm run deploy:cloud -- --env test                 部署全部 2 个函数到共享测试环境
//   npm run deploy:cloud -- --env product              部署全部 2 个函数到共享正式环境
//   npm run deploy:cloud -- --env test --names linggan_api
//   npm run deploy:cloud -- --env test --dry-run       只打印将要执行的命令
//   （--env 也接受原始环境 ID；不传环境一律拒绝，没有默认值）
//
// 依赖微信开发者工具的命令行（首次调用会自动启动开发者工具，需已登录），
// 路径可用 WECHAT_DEVTOOLS_CLI 环境变量覆盖。默认云端安装依赖，不上传本地 node_modules。
// 部署前强制跑 build-cloud --check：云函数目录与源码不一致就拒绝部署。

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const resources = require('../miniprogram/config/cloud-resources');

const ENV_ALIASES = { test: 'cloud1-d8gopnalv908bb47a', product: 'product-d2g59zty74d7d1ec1' };
const DEFAULT_CLI = 'E:\\weixinDevTool\\微信web开发者工具\\cli.bat';
const ALL_FUNCTIONS = [resources.apiFunction, resources.maintenanceFunction];

function parseArgs(argv) {
  const options = { env: '', names: [], dryRun: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--env') options.env = argv[++index] || '';
    else if (arg === '--names') { options.names = []; while (argv[index + 1] && !argv[index + 1].startsWith('--')) options.names.push(argv[++index]); }
    else if (arg === '--dry-run') options.dryRun = true;
    else throw Error('未知参数：' + arg + '（支持 --env <test|product|环境ID>、--names ...、--dry-run）');
  }
  if (!options.env) throw Error('必须显式指定 --env <test|product|环境ID>；脚本不提供默认环境');
  const envId = ENV_ALIASES[options.env] || options.env;
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(envId)) throw Error('环境 ID 不合法：' + envId);
  const names = options.names.length ? options.names : ALL_FUNCTIONS;
  for (const name of names) if (!ALL_FUNCTIONS.includes(name)) throw Error('未知函数：' + name);
  return { envId, names, dryRun: options.dryRun };
}

function main() {
  const { envId, names, dryRun } = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, '..');
  const check = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-cloud.cjs'), '--check'], { stdio: 'inherit' });
  if (check.status !== 0) {
    console.error('云函数目录与源码不一致，先运行 `node scripts/build-cloud.cjs` 同步再部署。');
    process.exit(1);
  }
  const cli = process.env.WECHAT_DEVTOOLS_CLI || DEFAULT_CLI;
  const args = ['cloud', 'functions', 'deploy', '--project', root, '--env', envId, '--names', ...names, '--remote-npm-install'];
  console.log('环境：' + envId + (envId === ENV_ALIASES.product ? '（正式环境）' : '（共享测试环境）'));
  console.log('函数：' + names.join(', '));
  const command = [cli, ...args].map(part => /[\s"]/.test(part) ? '"' + part.replace(/"/g, '\\"') + '"' : part).join(' ');
  if (dryRun) {
    console.log('dry-run，将执行：');
    console.log(command);
    return;
  }
  console.log('执行：' + command);
  const result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', command], { stdio: 'inherit' })
    : spawnSync(cli, args, { stdio: 'inherit' });
  if (result.error) {
    console.error('无法调用开发者工具命令行：' + result.error.message + '（可用 WECHAT_DEVTOOLS_CLI 指定 cli.bat 路径）');
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

try { main(); } catch (error) { console.error(String(error.message || error)); process.exit(1); }
