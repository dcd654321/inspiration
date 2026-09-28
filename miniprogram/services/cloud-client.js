'use strict';
const cloudConfig = require('../config/cloud');

function createCloudConnection({ config, getSdk }) {
  let pending = null;
  return function ready() {
    if (pending) return pending;
    pending = Promise.resolve().then(async () => {
      const sdk = getSdk();
      if (!config.enabled || !sdk || typeof sdk.Cloud !== 'function' ||
          !/^wx[a-f0-9]{16}$/.test(config.resourceAppid || '') ||
          typeof config.envId !== 'string' || !config.envId) throw Error('CLOUD_SHARED_UNAVAILABLE');
      const client = new sdk.Cloud({ resourceAppid: config.resourceAppid, resourceEnv: config.envId });
      await client.init();
      return client;
    }).catch((error) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

let activeSdk;
let connection;
function getCloudClient() {
  const sdk = typeof wx !== 'undefined' && wx.cloud;
  if (!connection || sdk !== activeSdk) {
    activeSdk = sdk;
    connection = createCloudConnection({ config: cloudConfig, getSdk: () => sdk });
  }
  return connection();
}

module.exports = { createCloudConnection, getCloudClient };
