import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const repo=process.env.CMS_REPO_PATH;
if(!repo?.includes('test-fixtures/'))throw new Error('Regression must use isolated test-fixtures');
const base=`http://127.0.0.1:${process.env.PORT||18789}/api/v1`;
await import('../server/src/index.ts');
let token='',passed=0;
async function req(method,url,data,form=false){const r=await fetch(base+url,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(!form&&data!==undefined?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:form?data:JSON.stringify(data)});return {status:r.status,data:await r.json()};}
function check(label,condition){assert.ok(condition,label);console.log('✓',label);passed++;}
for(let i=0;i<30;i++){try{await fetch(base+'/auth/me');break;}catch{await new Promise(r=>setTimeout(r,100));}}
token=(await req('POST','/auth/login',{password:'admin123'})).data.token;
let r=await req('GET','/posts?page=abc');check('拒绝非法分页',r.status===422);
r=await req('POST','/posts',{slug:'bad-date',data:{title:'bad',published:'2026-02-30'}});check('拒绝不存在的日期',r.status===422);
r=await req('POST','/posts',{slug:'invalid-commit',data:{title:'bad',published:'2026-10-30'},commitMessage:'bad'});check('错误提交说明不写入文件',r.status===422&&!fs.existsSync(path.join(repo,'src/content/posts/invalid-commit.md')));
r=await req('POST','/posts',{slug:'regression-post',data:{title:'回归验证',published:'2026-10-30',updated:'2026-10-30',series:'系列',seriesOrder:2,password:'test-password',description:'第一行\n第二行'},body:'# 验证'});check('创建含多行摘要的文章',r.status===201);
let p=(await req('GET','/posts/regression-post')).data;check('多行摘要原样读取',p.data.description==='第一行\n第二行');
r=await req('PUT','/posts/regression-post',{expected:p.version,data:{password:'',updated:null,seriesOrder:null},body:p.body});check('字段清空保存成功',r.status===200);
p=(await req('GET','/posts/regression-post')).data;check('密码日期与章节序号已清空',p.data.password===''&&!p.data.updated&&p.data.seriesOrder===undefined);
const form=new FormData();form.append('file',new Blob([Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64')],{type:'image/gif'}),'pixel.gif');
r=await req('POST','/posts/regression-post/images',form,true);check('图片上传路径包含文章目录',r.status===201&&r.data.refPath.startsWith('./images/regression-post/'));
const ref=r.data.refPath,name=r.data.name;
let imageResponse=await fetch(base+'/posts/regression-post/images/'+name,{headers:{Authorization:`Bearer ${token}`}});check('已登录可读取图片预览',imageResponse.status===200&&imageResponse.headers.get('content-type')==='image/gif');
imageResponse=await fetch(base+'/posts/regression-post/images/'+name);check('未登录不能读取图片',imageResponse.status===401);
r=await req('POST','/publish',{});check('未保存图片时阻止发布',r.status===409);
r=await req('PUT','/posts/regression-post',{expected:p.version,data:{},body:`# 图片\n![](${ref})`});check('保存文章及图片',r.status===200);
let st=(await req('GET','/git/status')).data;check('图片已提交，工作区干净',st.clean===true);
check('图片包含在最近一次提交',execFileSync('git',['show','--name-only','--format=','HEAD'],{cwd:repo,encoding:'utf8'}).includes(name));
r=await req('POST','/publish',{});check('含图片提交推送成功',r.status===200);
for(const [collection,data] of [['dynamic',{title:'动态',published:'2026-10-30',location:'测试'}],['projects',{title:'成员',published:'2026-10-30',link:[{label:'GitHub',value:'https://github.com/'}]}],['spec',{title:'测试页面'}]]){r=await req('POST',`/${collection}`,{slug:`regression-${collection}`,data,body:'# test'});check(`${collection} 内容创建`,r.status===201);const one=(await req('GET',`/${collection}/regression-${collection}`)).data;r=await req('PUT',`/${collection}/regression-${collection}`,{expected:one.version,data:{title:'修改后'},body:'# updated'});check(`${collection} 内容更新`,r.status===200);}
// Existing MDX must conflict with creation; sub-second external edits must invalidate version.
const mdx=path.join(repo,'src/content/posts/regression-mdx.mdx');fs.writeFileSync(mdx,'---\ntitle: MDX\npublished: 2026-10-30\n---\n\n# MDX');execFileSync('git',['add',mdx],{cwd:repo});execFileSync('git',['commit','-m','test: mdx fixture'],{cwd:repo});
r=await req('POST','/posts',{slug:'regression-mdx',data:{title:'duplicate',published:'2026-10-30'}});check('MDX 同名创建冲突',r.status===409);
p=(await req('GET','/posts/regression-mdx')).data;const before=fs.statSync(mdx);fs.utimesSync(mdx,before.atime,new Date(before.mtimeMs+100));r=await req('PUT','/posts/regression-mdx',{expected:p.version,data:{title:'overwrite'}});check('检测 MDX 毫秒级并发修改',r.status===409);
r=await req('GET','/missing-api');check('未知接口返回 JSON 404',r.status===404);
console.log(`回归结果：${passed} 项通过`);process.exit(0);
