'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
execFileSync(process.execPath,[path.join(__dirname,'prepare-clear-page-fixture.cjs')],{cwd:root,stdio:'pipe'});
const base=path.join(root,'qa/local/clear-page-20261028/project'),target=path.join(root,'qa/local/clear-page-20261028/project-capture-entries');
if(fs.existsSync(target))throw Error('FIXTURE_ALREADY_EXISTS');
fs.cpSync(base,target,{recursive:true});
const appFile=path.join(target,'miniprogram/app.js');let app=fs.readFileSync(appFile,'utf8');
const stub="photos: { add: async () => ({ ok: false, message: '此验证工程不上传照片。' }) }";
if(!app.includes(stub))throw Error('FIXTURE_STUB_CHANGED');
app=app.replace('App({ globalData:',`const {createCloudOnlyPhotoWorkflow}=require('./services/cloud-only-photo');
const photos=createCloudOnlyPhotoWorkflow({cacheScope:scope,store,
prepare:async()=>({ok:true,accepted:[{tempFilePath:'/assets/brand-mark.png',size:100}],rejected:[]}),
expectedFileId:(id,photoId)=>'cloud://qa.bucket/linggan/'+scope+'/'+id+'/'+photoId,
upload:async({inspirationId,photoId})=>({ok:true,fileId:'cloud://qa.bucket/linggan/'+scope+'/'+inspirationId+'/'+photoId}),
removeRemote:async()=>{}});
App({ globalData:`).replace(stub,'photos');
fs.writeFileSync(appFile,app);
const project=JSON.parse(fs.readFileSync(path.join(target,'project.config.json'),'utf8'));project.appid='touristappid';project.projectname='灵感首页照片标签隔离验收';fs.writeFileSync(path.join(target,'project.config.json'),JSON.stringify(project,null,2));
console.log(target);
