// Node 24+, no paid API calls: node tests/experience-discovery.cjs
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
  const {countExperiences,needsExperienceDiscovery,experienceQuestion,isExplicitNoMoreExperiences}=await import('../lib/experience-target.ts');
  const {applyDiscoveryExtraction,applyDiscoveryAnswer}=await import('../lib/experience-discovery.ts');
  const {reviewResume}=await import('../lib/review.ts');
  const {normalizeRewrites,checkBullet}=await import('../lib/pipeline.ts');
  const {bulletKey}=await import('../lib/review-types.ts');
  let passed=0; const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
  const fact=(id,text)=>({id,text,status:'user_confirmed',source:'cv_parse'});
  const makeCard=n=>({id:'c'+n,affiliation_id:'a'+n,name:'Experience '+n,my_role:null,context:[],my_actions:[fact('f'+n,'Prepared project notes.')],team_actions:[],methods:[],tools:[],skills:[],scale:[],outcomes:[],original_bullets:[{id:'b'+n,text:'Prepared project '+n+' notes.'}]});
  const db={education:[],affiliations:[1,2,3,4].map(n=>({id:'a'+n,organization:'Company '+n,title:'Analyst',type:n===4?'skills_list':n===1?'intern':'course_project',start_date:null,end_date:null})),cards:[1,2,3,4].map(makeCard)};
  const short={...db,cards:db.cards.filter(c=>c.id!=='c3')};
  const jd={role_title:'Data Analyst',requirements:[{id:'r1',text:'Analyze data',priority:'high',kind:'responsibility',keywords:['analysis']}]};
  const state={exhausted:false};
  const extraction={disposition:'record',follow_up_question:null,target_card_id:null,name:'Campus survey group project',organization:'Statistics class',title:null,type:'course_project',start_date:'2025',end_date:null,facts:[{field:'my_actions',text:'Cleaned survey responses using Python.'}],outcomes:[{note:'Reported response rate',value:80,unit:'%',basis:null}]};
  await test('internships and projects count together; skill cards do not count',()=>{assert.equal(countExperiences(db),3);assert.equal(countExperiences(short),2);});
  await test('fewer than three retained experiences triggers discovery even when more exist in the DB',()=>{assert(needsExperienceDiscovery(db,state,['c1','c2']));assert(!needsExperienceDiscovery(db,state));});
  await test('question names the JD, group assignments and a truthful opt-out',()=>{const q=experienceQuestion(short,jd,state);for(const text of ['Analyze data','小组作业','课程项目','没有'])assert(q.includes(text));});
  await test('only yes or a title never creates an empty experience',()=>{const r=applyDiscoveryExtraction(short,state,'有，一个课程项目',{...extraction,disposition:'clarify',facts:[],outcomes:[],follow_up_question:'你具体负责什么？'});assert.equal(r.db.cards.length,short.cards.length);assert.equal(r.discovery.followUp,'你具体负责什么？');assert(!r.discovery.exhausted);});
  await test('a model none classification cannot waive the goal for a single-category decline',()=>{const r=applyDiscoveryExtraction(short,state,'没有实习',{...extraction,disposition:'none',facts:[]});assert(!r.discovery.exhausted);assert(r.discovery.followUp.includes('小组作业'));});
  await test('explicit global no opts out without adding cards or altering the source',()=>{for(const answer of ['没有','没有其他相关经历','没有其他的相关经历了','没有更多相关的经历了','没有其他能补充的经历','No other projects',"I don't have any other relevant experience"]){assert(isExplicitNoMoreExperiences(answer),answer);const r=applyDiscoveryExtraction(short,state,answer);assert(r.discovery.exhausted);assert.equal(r.db,short);assert.equal(r.added_ids.length,0);assert(!needsExperienceDiscovery(r.db,r.discovery));}});
  await test('no internship but a real class project is not a global no',()=>{for(const a of ['没有实习','没有其他实习，但是做过课程项目','有一个小组作业'])assert(!isExplicitNoMoreExperiences(a));});
  await test('a question, hypothetical or negated no does not waive the goal',()=>{for(const a of ['如果没有其他经历怎么办','没有其他经历也可以吗？','不是没有其他经历，我做过小组项目','What if I have no other projects?'])assert(!isExplicitNoMoreExperiences(a));});
  const saved=JSON.stringify(short),added=applyDiscoveryExtraction(short,state,'课程作业：我用 Python 清洗问卷数据。',extraction),newId=added.new_card_ids[0];
  await test('a concrete new project brings the count to three without mutating the source',()=>{assert.equal(countExperiences(added.db),3);assert.equal(JSON.stringify(short),saved);assert.equal(added.new_card_ids.length,1);assert(!needsExperienceDiscovery(added.db,added.discovery));assert.equal(experienceQuestion(added.db,jd,added.discovery),null);});
  await test('discovery continues from zero through one and two until three distinct experiences',()=>{let next={...db,cards:db.cards.filter(c=>c.id==='c4')};for(let i=1;i<=3;i++){assert(needsExperienceDiscovery(next,state));next=applyDiscoveryExtraction(next,state,'项目：我负责整理分析数据。',{...extraction,name:'Distinct project '+i,organization:'Course '+i,outcomes:[]}).db;assert.equal(countExperiences(next),i);}assert(!needsExperienceDiscovery(next,state));});
  await test('dialogue facts are traceable while all extracted results remain unconfirmed',()=>{const c=added.db.cards.find(c=>c.id===newId);assert.equal(c.my_actions[0].source,'dialogue');assert.equal(c.outcomes[0].status,'ai_inferred');assert(!checkBullet(added.db,'Response rate was 80%.',[c.outcomes[0].id]).ok);assert.equal(c.original_bullets.length,0);});
  await test('the same experience is enriched rather than counted twice',()=>{const r=applyDiscoveryExtraction(added.db,state,'再补充这个项目',{...extraction,target_card_id:newId,facts:[...extraction.facts,{field:'tools',text:'Python'}]});assert.equal(r.new_card_ids.length,0);assert.equal(countExperiences(r.db),3);assert.equal(r.db.cards.find(c=>c.id===newId).my_actions.length,1);assert(r.discovery.followUp.includes('已经记录'));});
  await test('same project title at another organization is a separate real experience',()=>{const r=applyDiscoveryExtraction(added.db,state,'另一门课程的项目',{...extraction,organization:'Another class',start_date:'2026'});assert.equal(r.new_card_ids.length,1);assert.equal(countExperiences(r.db),4);});
  await test('empty cards, skill names and unconfirmed outcomes never satisfy the target',()=>{const copy=structuredClone(short),empty=makeCard(9);empty.original_bullets=[];empty.my_actions=[];empty.skills=[fact('f99','Python')];empty.outcomes=[{id:'o99',note:'Revenue increased',value:50,unit:'%',basis:null,status:'ai_inferred',source:'dialogue'}];copy.cards.push(empty);assert.equal(countExperiences(copy),2);});
  await test('shared duplicate original blocks do not inflate the count',()=>{const copy=structuredClone(short),duplicate=structuredClone(copy.cards[0]);duplicate.id='c99';copy.cards.push(duplicate);assert.equal(countExperiences(copy),2);});
  await test('new dialogue experience enters the final resume only after acceptance',()=>{const ids=added.db.cards.filter(c=>c.id!=='c4').map(c=>c.id),c=added.db.cards.find(c=>c.id===newId),f=c.my_actions[0];const rows=normalizeRewrites(added.db,ids,{cards:[{card_id:newId,bullets:[{original_bullet_id:null,text:f.text,source_ids:[f.id]}]}]});const pending=reviewResume(added.db,jd,[],rows,{});assert.equal(pending.resume.experienceCount,2);const key=bulletKey(newId,0,null,[f.id]);const accepted=reviewResume(added.db,jd,[],rows,{[key]:{status:'accepted',text:f.text}});assert.equal(accepted.resume.experienceCount,3);assert(accepted.resume.markdown.includes(f.text));});
  await test('excluding the last bullet reduces actual experience count, not only bullet count',()=>{const rows=normalizeRewrites(db,['c1','c2','c3'],{cards:[]});const r=reviewResume(db,jd,[],rows,{[bulletKey('c3',0,'b3')]:{status:'excluded',text:'Prepared project 3 notes.'}});assert.equal(r.resume.experienceCount,2);});
  await test('Mock discovery supports detailed projects, clarifications and a no-experience exit',async()=>{const title=await applyDiscoveryAnswer(short,jd,state,'问题','有');assert(!title.discovery.exhausted);assert.equal(title.new_card_ids.length,0);const category=await applyDiscoveryAnswer(short,jd,state,'问题','没有实习');assert(category.discovery.followUp.includes('小组作业'));const yes=await applyDiscoveryAnswer(short,jd,state,'问题','课程小组作业：我负责整理公开数据，并用 Python 分析趋势。');assert.equal(yes.new_card_ids.length,1);const no=await applyDiscoveryAnswer(short,jd,state,'问题','没有其他相关经历');assert(no.discovery.exhausted);});
  console.log(`${passed} experience-discovery regression cases passed; no paid API calls.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
