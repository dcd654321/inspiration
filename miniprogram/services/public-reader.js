'use strict';

const { getCloudClient, getCloudConnectionGeneration } = require('./cloud-client');

/** 只准备受信 Cloud 连接；阅读公开分享不以私人快照读取作为前置条件。 */
async function readPublicPage(page, options) {
  const opts = options || {};
  const getClient = opts.getClient || getCloudClient;
  const getGeneration = opts.getGeneration || getCloudConnectionGeneration;
  const app = getApp(), version = page.viewVersion, epoch = app.globalData.sessionEpoch;
  const generation = getGeneration();
  const isCurrent = () => page.visible !== false && page.viewVersion === version &&
    app.globalData.sessionEpoch === epoch && getGeneration() === generation;
  let client = null;
  try { client = await getClient(); }
  catch (err) { /* 当前页显示可恢复失败，不改私人身份，也不回退云环境。 */ }
  return { client, epoch, generation, isCurrent };
}

module.exports = { readPublicPage };
