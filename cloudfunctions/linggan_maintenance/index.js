'use strict';
const cloud = require('wx-server-sdk');
const { createRetentionService, createCloudRetentionDb, createMaintenanceHandler } = require('./server/retention');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const service = createRetentionService({ db: createCloudRetentionDb(cloud.database()) });
// 无默认触发器；仅受权服务端持密钥调用。不得记录 event/token/私人正文。
exports.main = createMaintenanceHandler({ run: service.run, context: () => cloud.getWXContext(), env: process.env });
