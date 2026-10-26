'use strict';

const TITLE = '灵感拾光簿｜随手记录灵感，手动整理成稿';
const IMAGE = '/assets/product-share.png';

function createAppShare() {
  return { title: TITLE, path: '/pages/welcome/index', imageUrl: IMAGE };
}

function createTimelineShare() {
  return { title: TITLE, query: '', imageUrl: IMAGE };
}

module.exports = { createAppShare, createTimelineShare };
