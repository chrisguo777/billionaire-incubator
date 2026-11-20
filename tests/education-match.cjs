// No network or paid API calls. The model module is replaced by an in-memory stub.
const assert = require('node:assert/strict');
const { registerHooks } = require('node:module');
const { existsSync } = require('node:fs');
const { fileURLToPath } = require('node:url');
const stub = 'data:text/javascript,' + encodeURIComponent(`
export const getMode = () => 'live';
export async function callStructured(schema, system, user, effort, options) {
 globalThis.educationCalls.push({system,user});
 const output = globalThis.educationReply;
 options?.check?.(output);
 return output;
}`);
registerHooks({ resolve(specifier, context, next) {
 if (specifier === './llm' && context.parentURL?.endsWith('/lib/pipeline.ts')) return {url:stub,shortCircuit:true};
 if (specifier.startsWith('.') && context.parentURL) {const u = new URL(specifier+'.ts',context.parentURL);if(existsSync(fileURLToPath(u)))return next(u.href,context);}
 return next(specifier,context);
}});
globalThis.educationCalls = [];
(async () => {
 const {checkEducation,isEducationRequirement,isEducationQuestion,renderEducation} = await import('../lib/education-match.ts');
 const {detectGaps,pickGap,askQuestion,matchExperience} = await import('../lib/pipeline.ts');
 const now = new Date('2026-11-20T12:00:00Z');
 const e = (degree,field,end_date='2024') => ({id:'e1',school:'Example University',degree,field,end_date,start_date:null,location:null,gpa:null,details:[]});
 const req = (text,kind='must_have',id='edu') => ({id,text,kind,priority:'high',keywords:[]});
 let n=0;const test=(name,fn)=>{fn();n++;console.log('PASS '+name);};
 test('recognizes explicit education requirements in both languages',()=>{
  for(const t of ["Bachelor's degree in Computer Science",'Master of Science in Statistics','MS in Statistics','PhD required','M.P.H. required','High school diploma',"Associate's degree",'GPA 3.5/4','Currently enrolled in a degree program','Graduating in 2027','本科及以上学历','硕士学位','统计相关专业']) assert(isEducationRequirement(req(t)),t);
 });
 test('does not turn technical skills or university clients into education requirements',()=>{
  for(const t of ['Strong SQL','MS Office proficiency','Master data management','Analyze healthcare records','Experience serving university clients','专业沟通能力','Use first-degree polynomial regression']) assert(!isEducationRequirement(req(t)),t);
 });
 test('matching degree and subject are covered without actions/results',()=>assert.equal(checkEducation(req("Bachelor's degree in Computer Science"),[e('B.S.','Computer Science')],now).status,'matched'));
 test('clear lower degree is a risk',()=>assert.equal(checkEducation(req('PhD in Statistics required'),[e('B.A.','Statistics')],now).status,'risk'));
 test('clear unrelated major is a risk',()=>assert.equal(checkEducation(req("Bachelor's degree in Computer Science"),[e('B.A.','Physics')],now).status,'risk'));
 test('related fields remain manual review',()=>assert.equal(checkEducation(req("Bachelor's degree in Computer Science or related field"),[e('B.A.','Mathematics')],now).status,'review'));
 test('in-progress degree is not treated as completed',()=>assert.equal(checkEducation(req("Master's degree in Statistics"),[e('M.S.','Statistics','May 2027 (Expected)')],now).status,'review'));
 test('explicitly allowed enrollment uses the confirmed degree',()=>assert.equal(checkEducation(req("Currently pursuing a master's degree in Statistics"),[e('M.S.','Statistics','2027 Expected')],now).status,'matched'));
 test('MSPH keeps its public-health meaning without inventing another degree',()=>assert.equal(checkEducation(req("Master's degree in Public Health"),[e('MSPH','Biostatistics')],now).status,'matched'));
 test('completed degree does not prove current enrollment',()=>assert.equal(checkEducation(req("Currently pursuing a master's degree in Statistics"),[e('M.S.','Statistics','2024')],now).status,'review'));
 test('future date alone does not imply completion',()=>assert.equal(checkEducation(req("Master's degree in Statistics"),[e('M.S.','Statistics','2027')],now).status,'review'));
 test('level and major must match within one record',()=>assert.equal(checkEducation(req('PhD in Computer Science'),[e('PhD','Physics'),{...e('B.S.','Computer Science'),id:'e2'}],now).status,'risk'));
 test('preferred qualification risk is not a hard gap',()=>{const pref=req('PhD in Statistics preferred','preferred');const gap=detectGaps({education:[e('B.A.','Statistics')],affiliations:[],cards:[]},{role_title:'Analyst',domain:'Data',seniority:'Junior',requirements:[pref]},{matches:[]},{});assert.equal(gap[0].status,'unknown');assert(gap[0].reason.includes('并非硬性门槛'));});
 test('empty education is unknown rather than fabricated',()=>assert.equal(checkEducation(req("Bachelor's degree"),[],now).status,'review'));
 test('equivalent experience is not hard rejected',()=>assert.equal(checkEducation(req("Master's degree or equivalent practical experience"),[e('B.A.','Mathematics')],now).status,'review'));
 test('GPA and graduation windows are surfaced for manual comparison',()=>{
  assert.equal(checkEducation(req('Minimum GPA 3.5/4'),[{...e('B.S.','Statistics'),gpa:'3.2/4'}],now).status,'review');
  assert.equal(checkEducation(req('Graduating between 2026 and 2027'),[e('B.S.','Statistics','2028 Expected')],now).status,'review');
 });
 test('unrecognized subject is not silently certified',()=>assert.equal(checkEducation(req("Bachelor's in Chemistry"),[e('B.A.','Physics')],now).status,'review'));
 test('several required degrees are not collapsed into one',()=>assert.equal(checkEducation(req("Bachelor's and Master's degrees"),[e('M.S.','Statistics')],now).status,'review'));
 test('uses edited and deleted educational records, not old CV text',()=>{
  assert.equal(checkEducation(req("Bachelor's degree in Computer Science"),[e('B.S.','Computer Science')],now).status,'matched');
  assert.equal(checkEducation(req("Bachelor's degree in Computer Science"),[e('B.A.','Physics')],now).status,'risk');
  assert.equal(checkEducation(req("Bachelor's degree in Computer Science"),[],now).status,'review');
  assert(!renderEducation([e('B.A.','Physics')]).includes('Computer Science'));
 });
 const db={education:[e('B.S.','Computer Science')],affiliations:[],cards:[]};
 const edu=req("Bachelor's degree in Computer Science");const skill=req('Strong SQL','must_have','sql');
 const jd={role_title:'Analyst',domain:'Data',seniority:'Junior',requirements:[edu,skill]};
 const gaps=detectGaps(db,jd,{matches:[]},{edu:'none'});
 test('education match overrides stale old no-experience answers',()=>assert.equal(gaps[0].status,'covered'));
 test('selector never chooses educational gaps even if client sends weak/unknown',()=>{
  const forged=[{...gaps[0],status:'unknown'},gaps[1]];
  assert.equal(pickGap(forged,jd,{}).requirement_id,'sql');
  assert.equal(pickGap([forged[0]],{...jd,requirements:[edu]},{}),null);
 });
 test('blocks educational question phrasings while permitting skills questions',()=>{
  for(const t of ['What is your highest degree?','Which university did you attend?','What did you study?','Where did you go to college?','What is your field of study?','你的专业是什么？','你哪年毕业？'])assert(isEducationQuestion(t),t);
  assert(!isEducationQuestion('How did you validate the SQL results?'));
 });
 await assert.rejects(askQuestion(db,gaps[0],edu),/教育要求/);assert.equal(globalThis.educationCalls.length,0);n++;
 globalThis.educationReply={matches:[]};await matchExperience(db,jd);
 assert(globalThis.educationCalls.at(-1).user.includes('Computer Science'));
 assert(globalThis.educationCalls.at(-1).user.includes('Strong SQL'));
 assert(!globalThis.educationCalls.at(-1).user.includes("Bachelor's degree in Computer Science"));n++;
 globalThis.educationReply={question:'Which university did you attend?'};
 await assert.rejects(askQuestion(db,gaps[1],skill),/教育资格细节/);n++;
 globalThis.educationReply={question:'How did you validate the SQL results?'};
 assert.equal(await askQuestion(db,gaps[1],skill),'How did you validate the SQL results?');
 assert(globalThis.educationCalls.at(-1).user.includes('Example University'));
 assert(globalThis.educationCalls.at(-1).system.includes('Never ask about degree'));n++;
 globalThis.educationReply={question:'为什么问：另一种说明。\n\nHow did you validate the SQL results?'};
 await assert.rejects(askQuestion(db,gaps[1],skill,[{question:'为什么问：旧说明。\n\nHow did you validate the SQL results?',answer:'I checked totals.'}],'zh',true),/历史重复/);n++;
 console.log(`${n} education matching / interview safeguards passed; zero API calls.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
