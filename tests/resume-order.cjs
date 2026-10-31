// Run with Node 24+: node tests/resume-order.cjs (no API calls).
const { stripTypeScriptTypes } = require('node:module');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const code = stripTypeScriptTypes(readFileSync(join(__dirname, '../lib/resume-order.ts'), 'utf8')).replace(/^import .*;$/gm, '').replace(/export /g, '');
const { dateOrder, orderResumeCards, isResumeSortMode } = new Function(code + '\nreturn {dateOrder,orderResumeCards,isResumeSortMode};')();
assert.equal(dateOrder('Sep 2025'),20250900);
assert.equal(dateOrder('September 2025'),20250900);
assert.equal(dateOrder('2025-09'),20250900);
assert.equal(dateOrder('2025年9月'),20250900);
assert.equal(dateOrder('09/2025'),20250900);
assert.equal(dateOrder('2025'),20250000);
assert.equal(dateOrder('Fall 2025'),20250000);
assert.equal(dateOrder('2025-02-30'),null);
assert.equal(dateOrder('2025-13'),null);
assert.equal(dateOrder('2025 - 2026'),null);
assert.equal(dateOrder('unknown'),null);
assert.equal(dateOrder(null),null);
assert(isResumeSortMode('chronological'));assert(!isResumeSortMode('invalid'));
const db={affiliations:[
 {id:'a-old',start_date:'2021-01',end_date:'2022-03'},
 {id:'a-new',start_date:'Jan 2025',end_date:'Sep 2025'},
 {id:'a-now',start_date:'2024年9月',end_date:'至今'},
 {id:'a-null',start_date:null,end_date:null},
 {id:'a-start',start_date:'2023-06',end_date:null},
],cards:[{id:'old',affiliation_id:'a-old'},{id:'new',affiliation_id:'a-new'},{id:'now',affiliation_id:'a-now'},{id:'unknown',affiliation_id:'a-null'},{id:'start',affiliation_id:'a-start'}]};
const ranked=[{card_id:'old',score:9,included:true},{card_id:'unknown',score:8,included:true},{card_id:'new',score:7,included:true},{card_id:'start',score:6,included:true},{card_id:'now',score:5,included:false}];
const modelOutput=[...ranked].reverse();
const snapshot=JSON.stringify({db,ranked,modelOutput});
const ids=cards=>cards.map(c=>c.card_id);
assert.deepEqual(ids(orderResumeCards(modelOutput,db,'relevance',ranked)),['old','unknown','new','start','now']);
assert.deepEqual(ids(orderResumeCards(modelOutput,db,'chronological',ranked)),['now','new','start','old','unknown']);
assert.equal(JSON.stringify({db,ranked,modelOutput}),snapshot);
assert.deepEqual(orderResumeCards(modelOutput,db,'chronological',ranked).filter(c=>c.included).map(c=>c.card_id).sort(),ranked.filter(c=>c.included).map(c=>c.card_id).sort());
const tiedDb={affiliations:[{id:'a',start_date:'2024',end_date:'Present'}],cards:[{id:'x',affiliation_id:'a'},{id:'y',affiliation_id:'a'}]};
assert.deepEqual(ids(orderResumeCards([{card_id:'x'},{card_id:'y'}],tiedDb,'chronological',[{card_id:'x',score:1},{card_id:'y',score:2}])),['y','x']);
assert.deepEqual(ids(orderResumeCards([{card_id:'y'},{card_id:'x'}],tiedDb,'relevance',[{card_id:'x',score:1},{card_id:'y',score:1}])),['x','y']);
console.log('PASS: date formats and invalid dates; relevance vs chronology; ongoing, missing end/date; stable ties; model output order; no mutation; same included cards.');
