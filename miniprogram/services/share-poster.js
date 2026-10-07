'use strict';

const MAX_PAGES = 9;
const MAX_CHARS = 1800;
const LINES_PER_PAGE = 17;
const LINE_UNITS = 23;

function units(char) { return /^[\x00-\x7F]$/.test(char) ? 0.55 : 1; }

/** 保留所有文字；超出可读页数时拒绝，不静默截断。 */
function paginatePoster(body) {
  if (typeof body !== 'string' || !body.trim() || body.length > MAX_CHARS) return null;
  const wrapped = [];
  for (const raw of body.replace(/\r\n/g, '\n').split('\n')) {
    if (!raw) { wrapped.push(''); continue; }
    let line = '';
    let width = 0;
    for (const char of Array.from(raw)) {
      const next = units(char);
      if (line && width + next > LINE_UNITS) {
        wrapped.push(line);
        line = '';
        width = 0;
      }
      line += char;
      width += next;
    }
    wrapped.push(line);
  }
  const pages = [];
  for (let index = 0; index < wrapped.length; index += LINES_PER_PAGE) {
    pages.push(wrapped.slice(index, index + LINES_PER_PAGE));
  }
  return pages.length <= MAX_PAGES ? pages : null;
}

function writeCodeFile(base64, filePath) {
  return new Promise((resolve, reject) => {
    if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) { reject(Error('INVALID_CODE')); return; }
    wx.getFileSystemManager().writeFile({
      filePath, data: base64, encoding: 'base64',
      success: resolve, fail: reject
    });
  });
}

function renderOne(page, lines, index, total, qrPath, title) {
  return new Promise((resolve, reject) => {
    const ctx = wx.createCanvasContext('posterCanvas', page);
    ctx.setFillStyle('#fffdf8');
    ctx.fillRect(0, 0, 750, 1000);
    ctx.setFillStyle('#34377f');
    ctx.setFontSize(28);
    ctx.fillText('灵感拾光簿 · 文字分享', 50, 66);
    ctx.setFillStyle('#191a23');
    ctx.setFontSize(34);
    ctx.fillText((title || '一份想法').slice(0, 18), 50, 120);
    ctx.setFillStyle('#333540');
    ctx.setFontSize(26);
    lines.forEach((line, row) => ctx.fillText(line || ' ', 50, 170 + row * 36));
    ctx.setStrokeStyle('#e6e4de');
    ctx.beginPath();
    ctx.moveTo(50, 820);
    ctx.lineTo(700, 820);
    ctx.stroke();
    ctx.drawImage(qrPath, 560, 834, 130, 130);
    ctx.setFillStyle('#6f6f7b');
    ctx.setFontSize(22);
    ctx.fillText('扫码在小程序中查看', 50, 875);
    ctx.fillText((index + 1) + ' / ' + total, 50, 915);
    ctx.draw(false, () => {
      wx.canvasToTempFilePath({
        canvasId: 'posterCanvas', width: 750, height: 1000,
        destWidth: 750, destHeight: 1000,
        success: (result) => resolve(result.tempFilePath), fail: reject
      }, page);
    });
  });
}

async function renderPosters(page, body, title, base64, codePath, isCurrent = () => true) {
  const pages = paginatePoster(body);
  if (!pages) throw Error('POSTER_TOO_LONG');
  const files = [];
  try {
    if (!isCurrent()) throw Error('STALE_PAGE');
    await writeCodeFile(base64, codePath);
    for (let index = 0; index < pages.length; index += 1) {
      if (!isCurrent()) throw Error('STALE_PAGE');
      files.push(await renderOne(page, pages[index], index, pages.length, codePath, title));
    }
    if (!isCurrent()) throw Error('STALE_PAGE');
    return files;
  } catch (err) {
    const manager = wx.getFileSystemManager();
    files.concat(codePath).forEach((filePath) => {
      try { manager.unlink({ filePath, fail() {} }); } catch (ignored) { /* 不掩盖原始生成失败。 */ }
    });
    throw err;
  }
}

module.exports = { paginatePoster, renderPosters, MAX_CHARS, MAX_PAGES };
