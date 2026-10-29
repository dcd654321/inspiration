'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../miniprogram/core/inspiration');
const {createSessionDrafts}=require('../miniprogram/services/session-drafts');
const sharedCloud=require('./helpers/shared-cloud.cjs');
const config=require('../miniprogram/config/cloud');
const scope='a'.repeat(32),input=value=>({detail:{value}});
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
async function capture(run){
const previous={Page:global.Page,getApp:global.getApp,wx:global.wx},file=require.resolve('../miniprogram/pages/capture/index');
let definition;const state={records:[],saves:[],adds:[],routes:[],result:{ok:true,synced:true},onSave:null,onAdd:null,sheet:null};
const drafts=createSessionDrafts();drafts.bind({cacheScope:scope,generation:1});
const store={getConfirmedRevision:()=>({baseVersion:1,generation:1}),getInspiration:id=>state.records.find(x=>x.id===id),refresh:async()=>({ok:true}),async saveInspiration(item){state.saves.push(item);const result=state.onSave?await state.onSave(item):state.result;if(result.ok&&result.synced)state.records.push(item);return result}};
const service={async add(id,source){state.adds.push({id,source});if(state.onAdd)return state.onAdd(id);const row=store.getInspiration(id);assert.ok(row,'先确认保存才可调用照片服务');state.records[state.records.indexOf(row)]=core.appendPhoto(row,{id:'photo_1',fileId:'cloud://'+config.envId+'.bucket/linggan/'+scope+'/'+id+'/photo_1',now:Date.now()});return {ok:true}}};
const app={globalData:{store,photos:service,cacheScope:scope,sessionEpoch:1,sessionDrafts:drafts},ensureReady:async()=>app.globalData.store};
try{
global.Page=value=>{definition=value};global.getApp=()=>app;global.wx={enableAlertBeforeUnload(){},disableAlertBeforeUnload(){},showActionSheet:options=>{state.sheet=options},navigateTo:options=>state.routes.push(options.url),cloud:sharedCloud({downloadFile:async()=>({tempFilePath:'wxfile://synthetic-display'})})};
delete require.cache[file];require(file);const page={...definition,data:structuredClone(definition.data),setData(next){Object.assign(this.data,next)}};await page.onShow();await run({page,state,app,store,service,drafts});
}finally{delete require.cache[file];for(const [key,value]of Object.entries(previous)){if(value===undefined)delete global[key];else global[key]=value}}
}

test('首页标签：正文标签待办一次保存，去重并在确认后复位',async()=>capture(async({page,state})=>{
page.onInput(input('给周末散步写一份清单'));page.onTagsInput(input('生活， 写作 生活'));page.onToggleTodo();await page.onSave();
assert.equal(state.saves.length,1);assert.deepEqual(state.saves[0].tags,['生活','写作']);assert.ok(state.saves[0].todo);assert.equal(page.data.tagsDraft,'');assert.equal(page.data.draft,'');
}));

test('首页标签：超限不发送，未知保留原标签且修改后不复用旧快照',async()=>capture(async({page,state})=>{
page.onInput(input('周末计划'));page.onTagsInput(input('一 二 三 四 五 六'));await page.onSave();assert.equal(state.saves.length,0);assert.match(page.data.errorText,/五个/);
page.onTagsInput(input('旧标签'));state.result={ok:false,code:'NETWORK'};await page.onSave();const old=state.saves[0];assert.equal(page.data.tagsDraft,'旧标签');assert.equal(page.data.status,'unknown');page.onTagsInput(input('旧标签'));await page.onSave();assert.equal(state.saves[1].id,old.id);
page.onTagsInput(input('新标签'));state.result={ok:true,synced:true};await page.onSave();assert.notEqual(state.saves[2].id,old.id);assert.deepEqual(state.saves[2].tags,['新标签']);
}));

test('首页照片：确认正文标签后上传并显示，重复添加沿用同一记录',async()=>capture(async({page,state})=>{
page.onInput(input('记录一次散步'));page.onTagsInput(input('散步 生活'));await page.addPhotos('album');
assert.equal(state.saves.length,1);assert.deepEqual(state.saves[0].tags,['散步','生活']);assert.equal(state.adds[0].id,page.data.lastSavedId);assert.equal(page.data.photos[0].src,'wxfile://synthetic-display');
page.onPreviewCapturePhoto({currentTarget:{dataset:{id:'photo_1'}}});assert.match(state.routes[0],/photo-viewer/);
await page.addPhotos('camera');assert.equal(state.saves.length,1);assert.equal(state.adds[1].id,state.adds[0].id);
}));

test('首页照片：空正文与未确认保存都不上传，取消来源选择不保存',async()=>capture(async({page,state})=>{
page.onAddPhoto();assert.match(page.data.photoError,/先写/);assert.equal(state.sheet,null);
page.onInput(input('还未确认的记录'));page.onAddPhoto();assert.ok(state.sheet);assert.equal(state.saves.length,0);
state.result={ok:false,code:'NETWORK'};await page.addPhotos('album');assert.equal(state.adds.length,0);assert.equal(page.data.status,'unknown');assert.equal(page.data.draft,'还未确认的记录');
}));

test('首页照片：保存期间离开或切换账户不继续选图上传',async()=>{
for(const mode of ['hide','account'])await capture(async({page,state,app})=>{
const wait=deferred();state.onSave=()=>wait.promise;page.onInput(input('原账户记录'));const pending=page.addPhotos('album');await new Promise(r=>setImmediate(r));
if(mode==='hide')page.onHide();else app.globalData.sessionEpoch++;
wait.resolve({ok:true,synced:true});await pending;assert.equal(state.adds.length,0);
});
});

test('首页照片：迟到回执不回填新页面，忙碌时不能改写标签',async()=>capture(async({page,state,app})=>{
page.onInput(input('确认后的记录'));await page.onSave();const wait=deferred();state.onAdd=()=>wait.promise;const pending=page.addPhotos('album');await new Promise(r=>setImmediate(r));
page.onTagsInput(input('不应接受'));assert.equal(page.data.tagsDraft,'');app.globalData.sessionEpoch++;wait.resolve({ok:true});await pending;assert.equal(page.data.photos.length,0);
}));

test('首页标签与照片：会话仅接续标签文字，开始下一条清除旧照片目标',async()=>capture(async({page,app,drafts,state})=>{
page.onTagsInput(input('只有标签'));page.onHide();await page.onShow();assert.equal(page.data.tagsDraft,'只有标签');page.onInput(input('新的正文'));await page.addPhotos('album');const id=page.data.lastSavedId;
page.onHide();const saved=drafts.get('capture',{cacheScope:scope,generation:1});assert.deepEqual(saved.data.photos,[]);assert.ok(!JSON.stringify(saved).includes('wxfile://'));await page.onShow();await page.loadCapturePhotos();assert.equal(page.data.lastSavedId,id);
page.onInput(input('下一条正文'));assert.equal(page.data.photos.length,0);assert.equal(page.data.lastSavedId,'');page.onTagsInput(input('下一条标签'));await page.addPhotos('album');assert.notEqual(state.adds[1].id,id);
}));
