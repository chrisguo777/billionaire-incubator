// Node 24+: local stub only; never sends an API request or invokes Codex.
const assert = require('node:assert/strict');
const {registerHooks} = require('node:module');
const {existsSync} = require('node:fs');
const {fileURLToPath} = require('node:url');
const stub = 'data:text/javascript,' + encodeURIComponent(`
export const calls=[];
export default class Anthropic {
  messages={parse:async(options)=>{calls.push(options);return {stop_reason:'end_turn',parsed_output:{answer:'api ok'}}}};
}`);
registerHooks({resolve(specifier,context,next){
  if(specifier==='@anthropic-ai/sdk')return {url:stub,shortCircuit:true};
  if(specifier.startsWith('.')&&context.parentURL){
    const url=new URL(specifier+'.ts',context.parentURL);
    if(existsSync(fileURLToPath(url)))return next(url.href,context);
  }
  return next(specifier,context);
}});
(async()=>{
  const previous={...process.env};
  const {z}=require('zod');
  const {calls}=await import(stub);
  const {getProvider,getMode,isProviderConfigured,callStructured}=await import('../lib/llm.ts');
  let passed=0;
  const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name)};
  const ask=()=>callStructured(z.object({answer:z.string()}),'Test system.','Test prompt.');
  try{
    for(const name of ['LLM_PROVIDER','LLM_MODE','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN'])delete process.env[name];
    process.env.CODEX_BIN='/must-never-be-invoked';
    await test('unconfigured automatic selection remains mock',()=>{
      assert.equal(getProvider(),'mock');assert.equal(getMode(),'mock');
    });
    process.env.LLM_PROVIDER='anthropic';process.env.LLM_MODE='live';
    await test('explicit API mode stays selected without a key and reports configuration needed',async()=>{
      assert.equal(getProvider(),'anthropic');assert.equal(getMode(),'live');assert.equal(isProviderConfigured(),false);
      await assert.rejects(ask(),/ANTHROPIC_API_KEY/);assert.equal(calls.length,0);
    });
    process.env.ANTHROPIC_API_KEY='   ';
    await test('whitespace is not a configured credential',()=>assert.equal(isProviderConfigured(),false));
    process.env.ANTHROPIC_API_KEY='local-stub-key';
    await test('API mode dispatches to the SDK stub even when Codex is unavailable',async()=>{
      assert.equal(isProviderConfigured(),true);assert.deepEqual(await ask(),{answer:'api ok'});
      assert.equal(calls.length,1);assert.equal(calls[0].messages[0].content,'Test prompt.');
    });
    delete process.env.ANTHROPIC_API_KEY;process.env.ANTHROPIC_AUTH_TOKEN='local-stub-token';
    await test('existing Anthropic auth-token setup remains supported',()=>{
      assert.equal(isProviderConfigured(),true);assert.equal(getProvider(),'anthropic');
    });
    process.env.LLM_MODE='mock';
    await test('explicit mock mode makes no SDK or Codex call',async()=>{
      assert.equal(getProvider(),'mock');await assert.rejects(ask(),/Mock/);assert.equal(calls.length,1);
    });
    delete process.env.LLM_MODE;process.env.LLM_PROVIDER='unsupported';
    await test('invalid or removed providers fail clearly',()=>{
      for(const provider of ['unsupported','codex']){
        process.env.LLM_PROVIDER=provider;
        assert.throws(getProvider,/LLM_PROVIDER/);
      }
    });
    console.log(passed+' API-provider regression cases passed; no paid API calls.');
  }finally{
    for(const name of Object.keys(process.env))if(!(name in previous))delete process.env[name];
    Object.assign(process.env,previous);
  }
})().catch(error=>{console.error(error);process.exitCode=1});
