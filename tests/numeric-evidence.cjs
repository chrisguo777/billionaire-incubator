// Node 24+, deterministic fixtures only. Never calls a model or reads API credentials.
const assert = require('node:assert/strict');
const { registerHooks } = require('node:module');
const { existsSync } = require('node:fs');
const { fileURLToPath } = require('node:url');
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL) {
    const url = new URL(specifier + '.ts', context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
} });
process.env.LLM_MODE = 'mock';

(async () => {
  const { checkBullet, normalizeRewrites } = await import('../lib/pipeline.ts');
  const { reviewResume } = await import('../lib/review.ts');
  const { bulletKey } = await import('../lib/review-types.ts');
  const original = 'Reconciled 18 missing category codes; no sales effect was measured.';
  const fact = (id, text, status = 'user_confirmed') => ({ id, text, status, source: 'cv_parse' });
  const makeDB = (text = original, field = 'my_actions') => {
    const card = { id:'c1', affiliation_id:'a1', name:'Retail reporting', my_role:null,
      context:[], my_actions:[], team_actions:[], methods:[], tools:[], skills:[], scale:[], outcomes:[],
      original_bullets:[{ id:'b1', text }] };
    card[field] = [fact('f1', text)];
    return { education:[], affiliations:[{ id:'a1', organization:'Harbor Retail', title:'Intern', type:'intern', start_date:null, end_date:null }], cards:[card] };
  };
  let passed = 0;
  const failures = [];
  const test = (name, fn) => { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failures.push(name + ': ' + e.message); console.error('FAIL ' + name + ': ' + e.message); } };
  const check = (source, target, ok, field = 'my_actions') => {
    const result = checkBullet(makeDB(source, field), target, ['f1'], 'c1');
    assert.equal(result.ok, ok, JSON.stringify(result));
    if (!ok) assert(result.issues.length > 0);
  };

  test('18 category codes cannot support 18% sales growth', () => check(original, 'Increased sales by 18%.', false));
  test('18 category codes cannot support 18 new customers even with the same count unit', () => check(original, 'Acquired 18 customers.', false));
  test('valid count paraphrase remains usable without repeating an unrelated sales disclaimer', () => check(original, 'Validated 18 missing category codes.', true));
  test('zero and negative values are preserved', () => {
    check('Observed sales change of -18%.', 'Sales change was 18%.', false);
    check('Observed 0 missing category codes.', 'Found 0 missing category codes.', true);
  });
  test('written negative signs and leading decimal points cannot change the number', () => {
    check('Observed sales change of minus 18%.', 'Observed sales change of 18%.', false);
    check('Observed sales change of negative eighteen percent.', 'Observed sales change of 18%.', false);
    check('Observed sales change of 18%.', 'Observed sales change of .18%.', false);
    check('Observed sales change of 0.18%.', 'Observed sales change of .18%.', true);
  });
  test('new numbers still fail', () => check(original, 'Reconciled 19 missing category codes.', false));
  test('thousands separators are normalized without losing a digit group', () => {
    check('Analyzed 12,000 patient records.', 'Reviewed 12000 patient records.', true);
    check('Analyzed 12,000 patient records.', 'Reviewed 12 patient records.', false);
    check('Analyzed 12,000 patient records.', 'Reviewed 000 patient records.', false);
  });
  test('percent and percentage points are distinct units', () => check('Increased conversion rate by 18 percentage points.', 'Increased conversion rate by 18%.', false));
  test('percent spelling and fullwidth symbols normalize', () => {
    check('Increased conversion rate by 18 percent.', 'Increased conversion rate by 18%.', true);
    check('销售额增长了１８％。', '销售额增长了18%。', true);
  });
  test('metric identity is checked within the same unit', () => check('Reduced error rate by 18%.', 'Reduced churn rate by 18%.', false));
  test('a comparison baseline cannot silently become a gain', () => check('Reduced error rate to 18%.', 'Reduced error rate by 18%.', false));
  test('decrease cannot become increase', () => check('Reduced sales by 18%.', 'Increased sales by 18%.', false));
  test('same metric and direction can be paraphrased', () => check('Increased sales by 18%.', 'Raised sales by 18 percent.', true));
  test('currency cannot be borrowed from a different metric or currency', () => {
    check('Managed a budget of USD 18,000.', 'Generated revenue of USD 18,000.', false);
    check('Managed a budget of USD 18,000.', 'Managed a budget of EUR 18,000.', false);
    check('Managed a budget of USD 18,000.', 'Managed a budget of $18000.', true);
  });
  test('duration units cannot change', () => check('Saved 18 hours of reporting time.', 'Saved 18 days of reporting time.', false));
  test('different numbers in the same sentence keep their metric bindings', () => {
    check('Reviewed 18 category codes and 50 survey responses.', 'Reviewed 18 survey responses and 50 category codes.', false);
    check('Reviewed 18 category codes and 50 survey responses.', 'Checked 50 survey responses and 18 category codes.', true);
  });
  test('different references cannot pool a number, a percent symbol and a metric', () => {
    const db = makeDB(original);
    db.cards[0].outcomes.push({ id:'o1', note:'Increased sales by 5%.', value:5, unit:'%', basis:null, status:'user_confirmed', source:'dialogue' });
    assert(!checkBullet(db, 'Increased sales by 18%.', ['f1','o1'], 'c1').ok);
    assert(checkBullet(db, 'Increased sales by 5%.', ['f1','o1'], 'c1').ok);
  });
  test('approximate counts must remain approximate', () => {
    check('Analyzed about 50 survey responses.', 'Analyzed 50 survey responses.', false);
    check('Analyzed about 50 survey responses.', 'Reviewed approximately 50 survey responses.', true);
  });
  test('unverified counts cannot lose their limitation', () => {
    check('About 50 survey responses; approximate, not checked.', 'Analyzed 50 survey responses.', false, 'scale');
    check('Analyzed about 50 survey responses, not yet verified.', 'Reviewed approximately 50 survey responses, unverified.', true, 'scale');
  });
  test('minimum, maximum and ranges are not exact counts', () => {
    check('Reviewed at least 18 reports.', 'Reviewed 18 reports.', false);
    check('Reviewed at least 18 reports.', 'Checked a minimum of 18 reports.', true);
    check('Reviewed 18–20 reports.', 'Reviewed 18 reports.', false);
  });
  test('the team total cannot become an individual total', () => {
    check('Our team produced 18 reports.', 'I produced 18 reports.', false, 'team_actions');
    check('Our team produced 18 reports.', 'Contributed to the team producing 18 reports.', true, 'team_actions');
  });
  test('a company result cannot become personal independent performance', () => {
    check('The company increased sales by 18%.', 'I increased sales by 18%.', false, 'context');
    check('Our team produced 18 reports.', 'Independently produced 18 reports with the team.', false, 'team_actions');
  });
  test('synthetic data and classroom context cannot silently become production results', () => {
    check('Built 18 reports using synthetic data in class.', 'Built 18 reports in production.', false);
    check('Built 18 reports using synthetic data in class.', 'Created 18 reports using synthetic data for a course.', true);
  });
  test('structured outcomes preserve their unit and basis', () => {
    const db = makeDB();
    db.cards[0].outcomes.push({ id:'o1', note:'Reduced reporting time', value:18, unit:'%', basis:'approximately; classroom simulation', status:'user_confirmed', source:'dialogue' });
    assert(!checkBullet(db, 'Reduced reporting time by 18%.', ['o1'], 'c1').ok);
    assert(checkBullet(db, 'Reduced reporting time by approximately 18% in a classroom simulation.', ['o1'], 'c1').ok);
  });
  test('one experience cannot borrow another experience’s result', () => {
    const db = makeDB();
    const other = structuredClone(db.cards[0]); other.id='c2'; other.affiliation_id='a2';
    other.original_bullets=[]; other.my_actions=[fact('foreign', 'Increased sales by 18%.')]; db.cards.push(other);
    assert(!checkBullet(db, 'Increased sales by 18%.', ['foreign'], 'c1').ok);
  });
  test('unconfirmed source cannot validate any numeric claim', () => {
    const db = makeDB('Increased sales by 18%.'); db.cards[0].my_actions[0].status='ai_inferred';
    assert(!checkBullet(db, 'Increased sales by 18%.', ['f1'], 'c1').ok);
  });
  test('Chinese counts cannot become percentages or a different object', () => {
    check('核对并补齐18个缺失的分类代码，未衡量销售影响。', '销售额提升18%。', false);
    check('核对并补齐18个缺失的分类代码。', '核对18个分类代码。', true);
    check('核对18个分类代码。', '新增18个客户。', false);
  });
  test('spelled-out numbers cannot bypass the same restrictions', () => {
    check(original, 'Increased sales by eighteen percent.', false);
    check('Reconciled eighteen category codes.', 'Checked 18 category codes.', true);
    check('核对十八个分类代码。', '销售额提升百分之十八。', false);
    check('核对十八个分类代码。', '核对18个分类代码。', true);
  });
  test('uncertain metric correspondence fails closed instead of returning a green pass', () => check('Processed 18 foobars.', 'Processed 18 bazquxes.', false));
  test('magnitude suffixes cannot turn 18 thousand into 18', () => {
    check('Reviewed 18 thousand reports.', 'Reviewed 18 reports.', false);
    check('Reviewed 18 thousand reports.', 'Checked 18000 reports.', true);
    check('核对18万个分类代码。', '核对18个分类代码。', false);
    check('核对18万个分类代码。', '核对180000个分类代码。', true);
  });
  test('minimum is not a strict greater-than claim', () => check('Reviewed at least 18 reports.', 'Reviewed more than 18 reports.', false));
  test('negated qualifiers cannot pretend to preserve an estimate or classroom context', () => {
    check('Analyzed about 50 survey responses.', 'Analyzed not approximately 50 survey responses.', false);
    check('Built 18 reports in class.', 'Built 18 reports outside the classroom.', false);
  });
  test('metrics cannot be exchanged between rates in one source', () => check('Increased sales by 5%; reduced error rate by 18%.', 'Increased sales by 18%; reduced error rate by 5%.', false));
  test('a negative measurement cannot become a positive result', () => check('No sales increase of 18% was measured.', 'Increased sales by 18%.', false));
  test('a total cannot acquire an unsupported subset modifier', () => check('Reviewed 18 category codes.', 'Reviewed 18 missing category codes.', false));
  test('comparison baselines and reporting periods cannot disappear', () => {
    check('Increased sales by 18% compared with the previous quarter.', 'Increased sales by 18%.', false);
    check('Increased sales by 18% compared with the previous quarter.', 'Raised sales by 18% versus the prior quarter.', true);
    check('Produced 18 reports per month.', 'Produced 18 reports.', false);
  });
  test('unchanged original is always retained and does not require a decision', () => {
    const db=makeDB(); const rows=normalizeRewrites(db,['c1'],{cards:[]});
    assert(rows[0].bullets[0].ok);
  });
  test('accepting a malicious suggestion or manual edit never puts it into the final resume', () => {
    const db=makeDB(); const bad='Increased sales by 18%.';
    const rows=normalizeRewrites(db,['c1'],{cards:[{card_id:'c1',bullets:[{original_bullet_id:'b1',text:bad,source_ids:['f1']}]}]});
    assert.equal(rows[0].bullets[0].ok,false);
    const jd={role_title:'Analyst',domain:'Retail',seniority:'Junior',requirements:[]};
    const reviewed=reviewResume(db,jd,[],rows,{[bulletKey('c1',0,'b1')]:{text:bad,status:'accepted'}});
    assert(reviewed.resume.markdown.includes(original));
    assert(!reviewed.resume.markdown.includes(bad));
    assert.equal(reviewed.stats.accepted,0);
    assert(reviewed.resume.warnings.length>0);
  });
  test('a valid numeric edit can still be accepted', () => {
    const db=makeDB(); const good='Validated 18 missing category codes.';
    const rows=normalizeRewrites(db,['c1'],{cards:[{card_id:'c1',bullets:[{original_bullet_id:'b1',text:good,source_ids:['f1']}]}]});
    const jd={role_title:'Analyst',domain:'Retail',seniority:'Junior',requirements:[]};
    const reviewed=reviewResume(db,jd,[],rows,{[bulletKey('c1',0,'b1')]:{text:good,status:'accepted'}});
    assert.equal(reviewed.stats.accepted,1);
    assert(reviewed.resume.markdown.includes(good));
  });
  console.log(JSON.stringify({passed,failed:failures.length,failures}));
  if (failures.length) process.exitCode=1;
})();
