import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import statusHandler from '../api/status.js';
import modelsHandler from '../api/models.js';
import inferHandler from '../api/infer.js';

function res(){
  return {code:200,headers:{},setHeader(name,value){this.headers[name]=value;return this;},
    status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
}
function req(method='GET',body=null,headers={}){
  return {method,body,headers:{host:'flops-murex.vercel.app',...headers}};
}
function withEnv(values,action){
  const before={};
  for(const [k,v] of Object.entries(values)){before[k]=process.env[k];if(v===null)delete process.env[k];else process.env[k]=v;}
  return Promise.resolve().then(action).finally(()=>{for(const [k,v] of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
}
test('web contains all five unified views and no external crypto script',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const id of ['home','identity','inference','community','activity'])assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/js\/unified\.js/);assert.match(html,/js\/crypto\.js/);
  assert.doesNotMatch(html,/cdn\.jsdelivr/);
  const legacy=await readFile(new URL('../legacy/index.html',import.meta.url),'utf8');
  assert.match(legacy,/Technocore Studio/);
});
test('status stays disabled until all hard safety gates are configured',async()=>{
  await withEnv({FLOPTRACE_ENABLE_INFERENCE:'1',FLOPTRACE_SPEND_CAP_ACK:null,FLOP_API_KEY:'test-only',FLOPTRACE_ACCESS_TOKEN:'test-only'},async()=>{
    const response=res();statusHandler(req(),response);
    assert.equal(response.body.inferenceEnabled,false);
    assert.equal(JSON.stringify(response.body).includes('test-only'),false);
  });
});
test('public models proxy filters IDs without leaking upstream details',async()=>{
  const before=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,json:async()=>({data:[{id:'sample/model',secret:'ignore'},{bad:'skip'}]})});
  try{
    const response=res();await modelsHandler(req(),response);
    assert.equal(response.code,200);assert.deepEqual(response.body.data,[{id:'sample/model'}]);
  }finally{globalThis.fetch=before;}
});
test('inference blocks unauthenticated and cross-origin requests',async()=>{
  await withEnv({FLOPTRACE_ENABLE_INFERENCE:'1',FLOPTRACE_SPEND_CAP_ACK:'1',FLOP_API_KEY:'upstream-key',FLOPTRACE_ACCESS_TOKEN:'my-passcode'},async()=>{
    const body={model:'sample/model',prompt:'Hello'};
    const a=res();await inferHandler(req('POST',body),a);assert.equal(a.code,401);
    const b=res();await inferHandler(req('POST',body,{authorization:'Bearer my-passcode',origin:'https://evil.example'}),b);assert.equal(b.code,403);
    const c=res();await inferHandler(req('POST',{...body,did:'did:key:zBogus'},{authorization:'Bearer my-passcode'}),c);assert.equal(c.code,400);
  });
});
test('successful mocked gateway response is explicitly NOT VERIFIED',async()=>{
  await withEnv({FLOPTRACE_ENABLE_INFERENCE:'1',FLOPTRACE_SPEND_CAP_ACK:'1',FLOP_API_KEY:'upstream-key',FLOPTRACE_ACCESS_TOKEN:'my-passcode'},async()=>{
    const before=globalThis.fetch;let sent;
    globalThis.fetch=async(url,options)=>{sent={url,options};return {ok:true,json:async()=>({id:'test-inference',choices:[{message:{content:'Mocked answer'}}]})};};
    try{
      const response=res();
      await inferHandler(req('POST',{model:'sample/model',prompt:'Hello',did:'did:key:z6MktYZcwhU44paRoi5AwahUv66jKAMsxXvf2TxaUzLs3yyG'},{authorization:'Bearer my-passcode',origin:'https://flops-murex.vercel.app'}),response);
      assert.equal(response.code,200);
      assert.equal(response.body.output,'Mocked answer');
      assert.equal(response.body.receipt.proofStatus,'NOT_VERIFIED');
      assert.equal(response.body.receipt.signatureStatus,'NOT_SIGNED');
      assert.equal(response.body.receipt.outputSha256.length,64);
      assert.ok(sent.url.endsWith('/chat/completions'));
      assert.equal(JSON.stringify(response.body).includes('upstream-key'),false);
      assert.equal(JSON.stringify(response.body.receipt).includes('Hello'),false);
      const requestBody=JSON.parse(sent.options.body);assert.equal(requestBody.max_tokens,512);
    }finally{globalThis.fetch=before;}
  });
});
test('no public inference when owner has not enabled private access',async()=>{
  await withEnv({FLOPTRACE_ENABLE_INFERENCE:null,FLOPTRACE_SPEND_CAP_ACK:null,FLOP_API_KEY:null,FLOPTRACE_ACCESS_TOKEN:null},async()=>{
    const response=res();await inferHandler(req('POST',{model:'sample/model',prompt:'Hello'}),response);
    assert.equal(response.code,503);
  });
});
