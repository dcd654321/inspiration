const cloudConfig = require('../../config/cloud');
const aiConfig = require('../../config/ai');

Page({
  data: {
    cloudEnabled: cloudConfig.enabled,
    aiEnabled: aiConfig.enabled,
    privacyNote: '你的灵感与照片只属于你。照片不会被写入日志、不会用于模型训练，也不会出现在任何分享场景。删除灵感时，对应的云端照片会一并清理。'
  }
});
