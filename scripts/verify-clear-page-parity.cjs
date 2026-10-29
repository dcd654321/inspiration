'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require('C:/Users/dcd/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const a=require('D:/codex/tmp/jiancheng-design-audit-runtime/node_modules/miniprogram-automator');
const out=path.resolve('docs/audits/2026-10-28-clear-page/parity');fs.mkdirSync(out,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const report={date:'2026-10-28',synthetic:true,cloudCalls:false,pairs:[],states:[]};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
(async()=>{
const mp=await a.connect({wsEndpoint:'ws://127.0.0.1:9474'});let browser;
try{
let fixture='';
for(let i=0;i<12&&!fixture;i++){
fixture=await mp.evaluate(()=>{const app=getApp();return app&&app.globalData&&app.globalData.qaFixture||''});
if(!fixture)await pause(500);
}
assert.equal(fixture,'clear-page-20261028');
await pause(1800);const win=await mp.evaluate(()=>wx.getWindowInfo());report.window={width:win.windowWidth,height:win.windowHeight};
browser=await chromium.launch({channel:'chrome',headless:true});const ref=await browser.newPage({viewport:{width:win.windowWidth,height:win.windowHeight},reducedMotion:'reduce'});
const groups={capture:[['editor','.capture-editor','.editor','height'],['switch','.switch-track','.todo-setting-switch','width','height'],['save','.action-footer .primary','.a-action-footer .save-btn','height','fontSize'],['title','.headrow h2','.capture-title','fontSize']],list:[['heading','.headrow','.a-heading','height'],['search','.search-box','.search-box','height'],['filter','.filterchip','.filter-chip','height','width','fontSize'],['add','.iconbtn','.add-link','height','width']],todos:[['scope','.scopebar button','.overview-item','height','fontSize'],['checkbox','.check-shape','.check-circle','height','width']],detail:[['primary','.detail-footer .primary','.a-supplement-action','height','fontSize'],['secondary','.detail-footer .secondary','.detail-actions .btn-quiet','height','fontSize']]};
for(const screen of ['capture','list','todos','detail','mine']){
await mp.reLaunch('/pages/'+screen+'/index'+(screen==='detail'?'?id=demo_walk':''));await pause(750);
await ref.goto(pathToFileURL(path.resolve('design-demos/2026-10-28/dir-1.html')).href+'?single='+screen);await ref.locator('.miniapp').waitFor();
await ref.screenshot({path:path.join(out,'reference-'+screen+'.png')});await mp.screenshot({path:path.join(out,'native-'+screen+'.png')});
for(const [name,rs,ns,...properties] of groups[screen]||[]){
const expected=await ref.locator(rs).first().evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {width:r.width,height:r.height,fontSize:parseFloat(s.fontSize)}});
const actual=await mp.evaluate(selector=>new Promise(resolve=>wx.createSelectorQuery().select(selector).fields({size:true,rect:true,computedStyle:['font-size']}).exec(v=>resolve(v[0]))),ns);
const item={screen,name,expected,actual:actual?{width:actual.width,height:actual.height,fontSize:parseFloat(actual['font-size'])}:null};item.diffs=Object.fromEntries(properties.map(p=>[p,actual?Math.abs(expected[p]-item.actual[p]):null]));item.pass=actual&&Object.values(item.diffs).every(x=>x<=1);report.pairs.push(item);save();
}
if(screen==='capture'){
const p=await mp.currentPage();await (await p.$('.todo-setting-toggle')).tap();await pause(250);assert.equal(await p.data('todoEnabled'),true);assert.ok(await p.$('.todo-setting-dates'));report.states.push('capture switch expands date settings');
await mp.screenshot({path:path.join(out,'native-capture-todo.png')});
await (await p.$('.editor')).input('合成记录：固定底栏确认保存。');await pause(150);
await (await p.$('.save-btn')).tap();await pause(350);
assert.ok(await p.data('lastSavedId'));assert.equal(await p.data('draft'),'');
assert.ok(await p.$('.editor'));report.states.push('capture footer confirms save and keeps next editor');
}
if(screen==='detail'){
const p=await mp.currentPage();assert.equal(await p.data('composeFocus'),false);await (await p.$('.a-supplement-action')).tap();await pause(600);assert.equal(await p.data('composeFocus'),true);await (await p.$('.compose-editor')).input('合成补充：底栏保存后独立保留。');await pause(120);await (await p.$('.a-supplement-action')).tap();await pause(400);assert.equal(await p.data('supplementDraft'),'');report.states.push('detail footer opens editor and confirms supplement');
await mp.screenshot({path:path.join(out,'native-detail-after-save.png')});
}
}
report.ok=report.pairs.every(x=>x.pass);save();console.log(JSON.stringify({ok:report.ok,pairs:report.pairs.length,failed:report.pairs.filter(x=>!x.pass),states:report.states},null,2));if(!report.ok)process.exitCode=1;
}finally{save();if(browser)await browser.close();await mp.disconnect()}
})().catch(e=>{report.error=e.message;save();console.error(e.message);process.exitCode=1});
