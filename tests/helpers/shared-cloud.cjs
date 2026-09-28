'use strict';
const assert = require('node:assert/strict');
const config = require('../../miniprogram/config/cloud');
module.exports = function sharedCloud(methods) {
  return {
    init() { throw Error('DEFAULT_CLOUD_FORBIDDEN'); },
    callFunction() { throw Error('DEFAULT_CLOUD_FORBIDDEN'); },
    Cloud: class {
      constructor(options) {
        assert.deepEqual(options, { resourceAppid: config.resourceAppid, resourceEnv: config.envId });
        Object.assign(this, methods);
      }
      async init() {}
    }
  };
};
