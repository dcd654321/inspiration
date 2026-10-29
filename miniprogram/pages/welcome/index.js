const { startCapture } = require('../../services/capture-entry');
const { createAppShare, createTimelineShare } = require('../../services/product-presentation');

Page({
  onShareAppMessage() { return createAppShare(); },
  onShareTimeline() { return createTimelineShare(); },
  onStart() { startCapture(); }
});
