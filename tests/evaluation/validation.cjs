// Deterministic checks; no model calls or API key access.
const { stripTypeScriptTypes } = require('node:module');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const code = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '../../lib/evaluation.ts'), 'utf8'))
  .replace(/^import .*;$/gm, '').replace(/export /g, '');
const DIMENSIONS = { relevance:'岗位匹配', contribution:'个人贡献', methods:'方法工具', outcomes:'成果', clarity:'清晰度', faithfulness:'事实' };
const FACT_FIELDS = ['context','my_actions','team_actions','methods','tools','skills','scale'];
const { validateEvidence, confirmedFacts } = new Function('DIMENSIONS','FACT_FIELDS', code + '\nreturn {validateEvidence, confirmedFacts};')(DIMENSIONS, FACT_FIELDS);
const db = { cards:[], affiliations:[] }, jd = {requirements:[]};
const make = () => ({ summary:'test', dimensions:Object.keys(DIMENSIONS).map(id=>({id,before:{score:3,reason:'test',evidence:[{source:'before',quote:'invented quote'}]},after:{score:2,reason:'test',evidence:[{source:'after',quote:'Used Python'}]},missing:[],suggestion:'test'})),fact_risks:[{quote:'invented',reason:'test',source_ids:[]}],next_actions:[] });
const result = validateEvidence(make(), 'Original resume', 'Used Python', db, jd);
assert(result.dimensions.every(d=>d.before.score===null && d.before.evidence.length===0 && d.after.score===2));
assert.equal(result.fact_risks.length,0);
const duplicate=make();duplicate.dimensions[1].id=duplicate.dimensions[0].id;
assert.throws(()=>validateEvidence(duplicate,'Original resume','Used Python',db,jd));
const missing=make();missing.dimensions.pop();assert.throws(()=>validateEvidence(missing,'Original resume','Used Python',db,jd));
const wrong=make();wrong.dimensions[0].after.evidence=[{source:'before',quote:'Original resume'}];
assert.equal(validateEvidence(wrong,'Original resume','Used Python',db,jd).dimensions[0].after.score,null);
console.log('PASS: invalid quotes, valid quotes, invented risks, duplicate/missing dimensions, wrong-version evidence');
const metadata = confirmedFacts({cards:[],affiliations:[{id:'a1',organization:'Example Company',title:'Analyst Intern',start_date:null,end_date:null}]});
assert.equal(metadata[0].id,'a1');assert(metadata[0].text.includes('Analyst Intern'));assert(metadata[0].text.includes('Example Company'));
console.log('PASS: company and role included in evaluator evidence');
