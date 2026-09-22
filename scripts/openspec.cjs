'use strict';
// Reuse this Node runtime without changing machine-wide PATH.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 19)) {
  console.error('OpenSpec requires Node.js >=20.19.0. Use a supported Node runtime.');
  process.exit(1);
}
const cli = path.resolve(__dirname, '../node_modules/@fission-ai/openspec/bin/openspec.js');
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, OPENSPEC_TELEMETRY: '0' }
});
if (result.error) console.error(result.error.message);
process.exit(result.status === null ? 1 : result.status);
