'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const a=require('D:/codex/tmp/jiancheng-design-audit-runtime/node_modules/miniprogram-automator');
const out=path.resolve('docs/audits/2026-10-28-clear-page/capture-entries');fs.mkdirSync(out,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));const report={date:'2026-10-28',synthetic:true,cloudCalls:false,realPhotoUpload:false,states:[]};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
(async()=>{const mp=await a.connect({wsEndpoint:'ws://127.0.0.1:9477'});let mocked=false;try{
let fixture='';for(let i=0;i<15&&!fixture;i++){fixture=await mp.evaluate(()=>{const app=getApp();return app&&app.globalData&&app.globalData.qaFixture||''});if(!fixture)await pause(500)}assert.equal(fixture,'clear-page-20261028');await pause(1800);await mp.reLaunch('/pages/capture/index');await pause(700);
let p=await mp.currentPage();if(await p.data('lastSavedId'))await p.callMethod('onRecordAnother');assert.ok(await p.$('.capture-photo-add'));assert.ok(await p.$('.capture-tags-input'));
await mp.screenshot({path:path.join(out,'01-home.png')});report.states.push('photo and tag controls visible');save();
await (await p.$('.editor')).input('合成验收：周末散步时记下的光影。');await (await p.$('.capture-tags-input')).input('散步，生活');await pause(120);await mp.screenshot({path:path.join(out,'02-tags.png')});
await mp.mockWxMethod('showActionSheet',{tapIndex:1});mocked=true;
await (await p.$('.capture-photo-add')).tap();await pause(900);
let state=await p.data();for(let i=0;i<6&&(state.saving||state.photoBusy);i++){await pause(500);state=await p.data()}
assert.ok(state.lastSavedId);assert.equal(state.photoBusy,false);assert.equal(state.photos.length,1);assert.ok(state.photos[0].src);assert.equal(state.photos[0].failed,false);
const first=state.lastSavedId;
const stored=await mp.evaluate(id=>{const data=getApp().globalData,record=data.store.getInspiration(id);return {tags:record.tags,count:record.photos.length,text:record.text}},first);
assert.deepEqual(stored.tags,['散步','生活']);assert.equal(stored.count,1);assert.equal(stored.text,'合成验收：周末散步时记下的光影。');
await mp.screenshot({path:path.join(out,'03-photo-added.png')});report.states.push('home photo action confirms text and tags, associates photo, renders private thumbnail');save();
await (await p.$('.capture-photo-cell')).tap();
for(let i=0;i<15;i++){p=await mp.currentPage();if(p.path==='pages/photo-viewer/index')break;await pause(200)}
assert.equal(p.path,'pages/photo-viewer/index');assert.equal(await p.data('error'),'');report.states.push('thumbnail opens current photo viewer');
await mp.screenshot({path:path.join(out,'04-viewer.png')});report.ok=true;save();fs.copyFileSync(path.join(out,'01-home.png'),path.resolve('docs/audits/2026-10-28-clear-page/parity/native-capture.png'));
console.log(JSON.stringify(report,null,2));
}finally{if(mocked)await mp.restoreWxMethod('showActionSheet').catch(()=>{});save();await mp.disconnect()}})().catch(e=>{report.error=e.message;save();console.error(e.message);process.exitCode=1});
