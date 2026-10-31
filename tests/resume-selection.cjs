// Node 24+, no API calls: node tests/resume-selection.cjs
const assert = require('node:assert/strict');
const {registerHooks} = require('node:module');
const {existsSync} = require('node:fs');
const {fileURLToPath} = require('node:url');
registerHooks({resolve(s,c,next){
  if(s.startsWith('.')&&c.parentURL){const u=new URL(s+'.ts',c.parentURL);if(existsSync(fileURLToPath(u)))return next(u.href,c);}
  return next(s,c);
}});
process.env.LLM_MODE='mock';
(async()=>{
  const {rankCards,normalizeRewrites}=await import('../lib/pipeline.ts');
  const {reviewResume}=await import('../lib/review.ts');
  const {selectResumeCards,InvalidCardSelectionError}=await import('../lib/resume-selection.ts');
  const {bulletKey}=await import('../lib/review-types.ts');
  let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
  const fact=(id,text,source='cv_parse')=>({id,text,status:'user_confirmed',source});
  const card=n=>({id:'c'+n,affiliation_id:'a'+n,name:'Experience '+n,my_role:null,context:[],
    my_actions:[fact('f'+n,'Prepared analysis notes for project '+n)],team_actions:[],methods:[],tools:[],skills:[],scale:[],outcomes:[],
    original_bullets:[{id:'b'+n,text:'Prepared analysis notes for project '+n+'.'}]});
  const db={education:[],affiliations:Array.from({length:7},(_,i)=>({id:'a'+(i+1),organization:'Company '+(i+1),title:'Analyst',type:i===6?'skills_list':'work',start_date:'202'+i,end_date:'202'+i})),cards:Array.from({length:7},(_,i)=>card(i+1))};
  db.cards[0].outcomes=[{id:'o1',note:'Team used the analysis notes.',value:null,unit:null,basis:null,status:'user_confirmed',source:'cv_parse'}];
  const jd={role_title:'Analyst',domain:'Data',seniority:'Junior',requirements:[
    {id:'r1',text:'Analyze data',kind:'responsibility',priority:'high',keywords:['analysis']},
    {id:'r2',text:'Create reports',kind:'responsibility',priority:'medium',keywords:['report']},
  ]};
  const gaps=[
    {requirement_id:'r1',status:'covered',evidence_fact_ids:['f1','o1'],related_card_ids:['c1'],reason:'covered'},
    {requirement_id:'r2',status:'weak',evidence_fact_ids:['f2'],related_card_ids:['c2'],reason:'missing result'},
    {requirement_id:'r2',status:'unknown',evidence_fact_ids:[],related_card_ids:['c3'],reason:'missing detail'},
  ];
  const ranked=rankCards(db,jd,gaps), ids=ranked.map(r=>r.card_id);
  const rows=normalizeRewrites(db,ids,{cards:[]});
  const review=(selected,choices={},sort='relevance')=>reviewResume(db,jd,gaps,rows,choices,sort,selected);
  test('all six experiences remain selected, including zero-score and beyond the old four-card cap',()=>{
    assert.equal(ranked.length,6);assert(ranked.every(r=>r.included));assert(ranked.some(r=>r.score===0));
    assert(!ids.includes('c7'));assert.equal(review().resume.experienceBulletCount,6);
  });
  test('covered, weak, unknown-related and unmatched cards get distinct evidence explanations',()=>{
    assert.equal(ranked.find(r=>r.card_id==='c1').evidence_status,'supported');
    for(const id of ['c2','c3'])assert.equal(ranked.find(r=>r.card_id===id).evidence_status,'insufficient');
    assert.equal(ranked.find(r=>r.card_id==='c6').evidence_status,'unmatched');
    assert(ranked.find(r=>r.card_id==='c3').reasons.some(r=>r.includes('证据不足')));
  });
  test('an unknown-related zero-score experience can be retained on its own',()=>{
    const r=review(['c3']);assert.equal(r.resume.experienceBulletCount,1);
    assert(r.resume.markdown.includes('project 3'));assert(!r.resume.markdown.includes('project 1'));
    assert(r.ranked.find(r=>r.card_id==='c3').included);assert(!r.ranked.find(r=>r.card_id==='c1').included);
  });
  test('explicitly selecting none removes every experience',()=>{
    const r=review([]);assert.equal(r.resume.experienceBulletCount,0);assert.equal(r.stats.retained,0);
  });
  test('invalid selection types, unknown IDs and skills-card IDs are rejected',()=>{
    for(const value of [null,'c1',[1],['missing'],['c7']])assert.throws(()=>selectResumeCards(ranked,value),InvalidCardSelectionError);
    assert.equal(selectResumeCards(ranked,['c2','c2']).filter(r=>r.included).length,1);
  });
  test('deselecting and reselecting restores an accepted edit without changing the source cache',()=>{
    const key=bulletKey('c2',0,'b2'),text='Prepared project 2 analysis notes.';
    const choices={[key]:{text,status:'accepted'}};
    const snapshot=JSON.stringify({db,rows,choices});
    assert(!review(['c1'],choices).resume.markdown.includes(text));
    const restored=review(['c1','c2'],choices);assert(restored.resume.markdown.includes(text));assert.equal(restored.stats.accepted,1);
    assert.equal(JSON.stringify({db,rows,choices}),snapshot);
  });
  test('both sorting modes honor exactly the same retained experiences',()=>{
    for(const sort of ['relevance','chronological']){
      const r=review(['c2','c6'],{},sort);assert.equal(r.resume.experienceBulletCount,2);
      assert(r.resume.markdown.includes('project 2'));assert(r.resume.markdown.includes('project 6'));assert(!r.resume.markdown.includes('project 1'));
    }
  });
  test('retaining an experience never promotes unconfirmed outcomes or accepts a new bullet',()=>{
    const copy=structuredClone(db),c=copy.cards[3];c.original_bullets=[];c.my_actions=[fact('f4','Prepared a dashboard checklist.','dialogue')];
    c.outcomes=[{id:'pending4',note:'Increased revenue',value:999,unit:'%',basis:null,status:'ai_inferred',source:'dialogue'}];
    const proposals=normalizeRewrites(copy,ids,{cards:[{card_id:'c4',bullets:[{original_bullet_id:null,text:'Increased revenue by 999%.',source_ids:['f4','pending4']}]}]});
    const key=bulletKey('c4',0,null,['f4','pending4']);
    const r=reviewResume(copy,jd,gaps,proposals,{[key]:{text:'Increased revenue by 999%.',status:'accepted'}},'relevance',['c4']);
    assert.equal(r.resume.experienceBulletCount,0);assert.equal(r.stats.accepted,0);assert.equal(copy.cards[3].outcomes[0].status,'ai_inferred');
  });
  test('shared originals transfer to a retained card and new-bullet choices remain stable when row positions shift',()=>{
    const copy=structuredClone(db),other=card(8);other.affiliation_id='a1';other.original_bullets=structuredClone(copy.cards[0].original_bullets);
    other.my_actions=[fact('f8','Documented a handover checklist.','dialogue')];copy.cards.push(other);
    const allIds=rankCards(copy,jd,gaps).map(r=>r.card_id);
    const cache=normalizeRewrites(copy,allIds,{cards:[{card_id:'c8',bullets:[{original_bullet_id:null,text:'Documented a handover checklist.',source_ids:['f8']}]}]});
    assert.equal(cache.find(c=>c.card_id==='c8').bullets.length,1);
    const key=bulletKey('c8',0,null,['f8']);assert.equal(key,bulletKey('c8',1,null,['f8']));
    const r=reviewResume(copy,jd,gaps,cache,{[key]:{text:'Documented a handover checklist.',status:'accepted'}},'relevance',['c8']);
    assert.equal(r.resume.experienceBulletCount,2);assert.equal(r.stats.accepted,1);
    assert(r.resume.markdown.includes('project 1'));assert(r.resume.markdown.includes('handover checklist'));
  });
  console.log(`${passed} resume-selection regression cases passed; no paid API calls.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
