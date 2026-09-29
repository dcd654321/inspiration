'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'deployment/product');
const manifest = require('../deployment/product/manifest.json');
const cloudConfig = require('../miniprogram/config/cloud');
const project = require('../project.config.json');

test('product deployment manifest only targets the confirmed shared environment and project resources', () => {
  assert.equal(manifest.environmentId, 'product-d2g59zty74d7d1ec1');
  assert.equal(manifest.resourceAppid, 'wx7ad85943fe81e095');
  assert.equal(manifest.consumerAppid, 'wxed8fdc5d559d973d');
  assert.equal(manifest.environmentId, cloudConfig.resolveCloudConfig('release').envId);
  assert.equal(manifest.resourceAppid, cloudConfig.resourceAppid);
  assert.equal(manifest.consumerAppid, project.appid);
  assert.equal(manifest.clientDatabaseAccess, 'deny-all');
  assert.deepEqual(manifest.collections.map((item) => item.name), [
    'linggan_accounts', 'linggan_shares', 'linggan_feedback',
    'linggan_usage', 'linggan_rate_limits', 'linggan_ai_usage'
  ]);
});

test('product index inputs contain all fifteen designed indexes without deletion or TTL', () => {
  const expected = {
    linggan_accounts: [['accountKey:1', true]],
    linggan_shares: [
      ['tokenHash:1', true], ['ownerAccountKey:1,requestId:1', true],
      ['ownerAccountKey:1,_id:-1', false], ['ownerAccountKey:1,sourceInspirationId:1,revokedAt:1', false],
      ['payloadPurgedAt:1,expiresAt:1,_id:1', false], ['payloadPurgedAt:1,revokedAt:1,_id:1', false]
    ],
    linggan_feedback: [
      ['accountKey:1,requestId:1', true], ['dedupeKey:1', true],
      ['accountKey:1,_id:-1', false], ['status:1,createdAt:-1', false],
      ['status:1,closedAt:1,_id:1', false], ['status:1,createdAt:1,_id:1', false]
    ],
    linggan_usage: [],
    linggan_rate_limits: [['expiresAt:1', false]],
    linggan_ai_usage: [['expiresAt:1', false]]
  };
  let count = 0;
  for (const collection of manifest.collections) {
    if (collection.indexesFile === null) {
      assert.deepEqual(expected[collection.name], []);
      continue;
    }
    assert.equal(collection.indexesFile, `indexes/${collection.name}.json`);
    const input = JSON.parse(fs.readFileSync(path.join(directory, collection.indexesFile), 'utf8'));
    assert.deepEqual(Object.keys(input), ['CreateIndexes']);
    const indexes = input.CreateIndexes;
    assert.equal(new Set(indexes.map((item) => item.IndexName)).size, indexes.length);
    const actual = indexes.map((index) => {
      assert.deepEqual(Object.keys(index), ['IndexName', 'MgoKeySchema']);
      assert.match(index.IndexName, /^[A-Za-z][A-Za-z0-9_]{0,63}$/);
      const schema = index.MgoKeySchema;
      assert.deepEqual(Object.keys(schema), ['MgoIndexKeys', 'MgoIsUnique', 'MgoIsSparse']);
      assert.equal(schema.MgoIsSparse, false);
      for (const field of schema.MgoIndexKeys) assert.deepEqual(Object.keys(field), ['Name', 'Direction']);
      return [schema.MgoIndexKeys.map((field) => `${field.Name}:${field.Direction}`).join(','), schema.MgoIsUnique];
    });
    assert.deepEqual(actual, expected[collection.name]);
    count += indexes.length;
  }
  assert.equal(count, 15);
});

test('product function plan keeps AI photos and maintenance disabled and contains no secret values', () => {
  assert.deepEqual(manifest.functions.map((item) => item.name), ['linggan_api', 'linggan_ai', 'linggan_maintenance']);
  for (const fn of manifest.functions) {
    assert.equal(fn.directory, `cloudfunctions/${fn.name}`);
    assert.ok(fs.existsSync(path.join(root, fn.directory, 'index.js')));
    assert.equal(fn.remoteNpmInstall, true);
    for (const name of fn.requiredSecretNames) assert.equal(Object.hasOwn(fn.nonSecretEnvironment, name), false);
    if (fn.openapi) {
      const config = JSON.parse(fs.readFileSync(path.join(root, fn.directory, 'config.json'), 'utf8'));
      assert.deepEqual(fn.openapi, config.permissions.openapi);
    }
  }
  const [api, ai, maintenance] = manifest.functions;
  assert.equal(api.nonSecretEnvironment.LINGGAN_PHOTOS_ENABLED, 'false');
  assert.equal(api.nonSecretEnvironment.LINGGAN_SHARE_CODE_VERSION, 'release');
  assert.deepEqual(api.requiredSecretNames, ['LINGGAN_SHARE_TOKEN_KEY']);
  assert.equal(ai.nonSecretEnvironment.LINGGAN_AI_ENABLED, 'false');
  assert.equal(ai.minimumTimeoutSecondsBeforeEnable, 60);
  assert.equal(maintenance.nonSecretEnvironment.LINGGAN_MAINTENANCE_ENABLED, 'false');
  assert.deepEqual(maintenance.triggers, []);
  assert.deepEqual(maintenance.requiredSecretNames, ['LINGGAN_MAINTENANCE_TOKEN']);
});
