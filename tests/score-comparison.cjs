// Node 24+, no model calls: node tests/score-comparison.cjs
const assert = require('node:assert/strict');
const {registerHooks} = require('node:module');
const {existsSync} = require('node:fs');
const {fileURLToPath} = require('node:url');
registerHooks({resolve(s,c,next){
  if(s.startsWith('.')&&c.parentURL){const u=new URL(s+'.ts',c.parentURL);if(existsSync(fileURLToPath(u)))return next(u.href,c);}
  return next(s,c);
}});
(async()=>{
  const {compareScores,SCORE_WEIGHTS}=await import('../lib/score-comparison.ts');
  const ids=['relevance','contribution','methods','outcomes','clarity','faithfulness'];
  const make=(before,after)=>ids.map((id,i)=>({id,before:{score:before[i]},after:{score:after[i]}}));
  let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
  test('confirmed product weights add to 100 and weighted totals use the 0–100 scale',()=>{
    assert.equal(Object.values(SCORE_WEIGHTS).reduce((a,b)=>a+b,0),100);
    const r=compareScores(make([1,1,2,1,1,3],[2,2,2,2,2,3]));
    assert.equal(r.before,51.7);assert.equal(r.after,73.3);assert.equal(r.delta,21.6);assert.equal(r.includedCount,6);
  });
  test('one-sided null excludes that dimension from BOTH denominators, never substitutes zero',()=>{
    const r=compareScores(make([1,1,2,1,1,null],[2,2,2,2,2,3]));
    assert.equal(r.before,39.6);assert.equal(r.after,66.7);assert.equal(r.includedCount,5);
    assert.deepEqual(r.excludedLabels,['事实一致性']);assert.equal(r.rows[5].after,3);assert.equal(r.rows[5].delta,null);
  });
  test('different missing dimensions still compare only the intersection',()=>{
    const r=compareScores(make([null,1,2,1,1,3],[2,2,2,2,2,null]));
    assert.equal(r.includedCount,4);assert.equal(r.before,42.4);assert.equal(r.after,66.7);
  });
  test('zero is a real score; a completely unscored report has no overall or delta',()=>{
    const zero=Array(6).fill(0),empty=Array(6).fill(null);
    assert.equal(compareScores(make(zero,zero)).before,0);
    const r=compareScores(make(empty,empty));assert.equal(r.before,null);assert.equal(r.after,null);assert.equal(r.delta,null);assert.equal(r.includedCount,0);
  });
  test('lower scores and unchanged scores remain visible instead of being forced positive',()=>{
    const all=n=>Array(6).fill(n);
    assert.equal(compareScores(make(all(3),all(2))).delta,-33.3);
    assert.equal(compareScores(make(all(2),all(2))).delta,0);
  });
  test('normalizing ratio weights gives identical totals; zero-weight rows are excluded',()=>{
    const data=make([1,1,2,1,1,3],[2,2,2,2,2,3]);
    const doubled=Object.fromEntries(ids.map(id=>[id,SCORE_WEIGHTS[id]*2]));
    assert.equal(compareScores(data,doubled).before,compareScores(data).before);
    assert.equal(compareScores(data,{...SCORE_WEIGHTS,faithfulness:0}).includedCount,5);
  });
  test('invalid scores cannot overflow bars or contaminate the total; invalid weights fail',()=>{
    const r=compareScores(make([NaN,-1,4,1.5,null,2],[1,1,1,1,1,2]));assert.equal(r.includedCount,1);assert.equal(r.before,66.7);
    for(const value of [-1,NaN])assert.throws(()=>compareScores([], {...SCORE_WEIGHTS,relevance:value}));
    assert.throws(()=>compareScores([],Object.fromEntries(ids.map(id=>[id,0]))));
  });
  test('canonical dimension order is stable and neither inputs nor weights are mutated',()=>{
    const data=make([1,1,2,1,1,3],[2,2,2,2,2,3]).reverse();const snapshot=JSON.stringify(data);
    const r=compareScores(data);assert.deepEqual(r.rows.map(x=>x.id),ids);assert.equal(JSON.stringify(data),snapshot);
  });
  console.log(passed+' score comparison regression cases passed; no paid calls.');
})().catch(e=>{console.error(e);process.exitCode=1;});
