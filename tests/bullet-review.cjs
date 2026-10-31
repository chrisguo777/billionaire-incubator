// Node 24+, no model calls: node tests/bullet-review.cjs
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
  const { extractOriginalBullets } = await import('../lib/original-bullets.ts');
  const { normalizeRewrites, checkBullet, parseCV, analyzeJD, matchExperience, detectGaps, rankCards, rewriteBullets } = await import('../lib/pipeline.ts');
  const { reviewResume } = await import('../lib/review.ts');
  const { bulletKey } = await import('../lib/review-types.ts');
  const { confirmedFacts } = await import('../lib/evaluation.ts');
  const { SAMPLE_CV } = await import('../lib/sample.ts');
  let passed = 0;
  const test = (name, fn) => { fn(); passed++; console.log('PASS ' + name); };

  const full = 'Cleaned survey responses using Python pandas; created neighborhood charts.\nDocumented missing values and presented the findings to a supervisor.';
  const second = 'The report informed follow-up interviews. I did not run an A/B test.';
  const extracted = extractOriginalBullets(`EXPERIENCE\n\nExample Lab\n- ${full.replace('\n', '\n  ')}\n- ${second}\n\nSKILLS\nPython`);
  test('semicolon, second sentence and wrapped lines stay in one complete original', () => {
    assert.equal(extracted.find(b => b.id === 'cvb4').text, full);
    assert.equal(extracted.find(b => b.text === second).text, second);
    assert(!extracted.some(b => b.text === 'created neighborhood charts.'));
  });
  test('Word-style paragraphs, Unicode and numbered markers preserve full text', () => {
    assert.deepEqual(extractOriginalBullets('• 分析数据；记录缺失值。\n  向团队汇报。\n1. 第二条完整原句。').map(b => b.text), ['分析数据；记录缺失值。\n向团队汇报。', '第二条完整原句。']);
    assert.equal(extractOriginalBullets('Cleaned records; documented methods.\nPresented findings.\n\nSecond paragraph.')[0].text, 'Cleaned records; documented methods.\nPresented findings.');
  });
  test('a dated next-role heading is not appended to the previous bullet', () => {
    const blocks = extractOriginalBullets('- Prepared charts and wrote a report.\nOther Lab — Research Assistant | 2025 – 2026\n- Cleaned survey data.');
    assert.equal(blocks[0].text, 'Prepared charts and wrote a report.');
    assert.equal(blocks[2].text, 'Cleaned survey data.');
  });
  test('negative numbers and year text are not mistaken for list markers', () => {
    assert.equal(extractOriginalBullets('-12% change in an observed metric.')[0].text, '-12% change in an observed metric.');
    assert.equal(extractOriginalBullets('2024. Analysis project.')[0].text, '2024. Analysis project.');
  });
  const fact = (id, text, source = 'cv_parse', status = 'user_confirmed') => ({ id, text, source, status });
  const makeCard = (id, affiliation_id, originals) => ({ id, affiliation_id, name: id, my_role: null,
    context: [], my_actions: [fact('f-' + id, 'Cleaned survey responses using Python')],
    team_actions: [], methods: [], tools: [], skills: [], scale: [], outcomes: [], original_bullets: originals });
  const db = { education: [], affiliations: [
    { id: 'a1', organization: 'Example Lab', title: 'Analyst', type: 'research', start_date: '2020', end_date: '2021' },
    { id: 'a2', organization: 'Recent Lab', title: 'Analyst', type: 'work', start_date: '2025', end_date: '2026' },
  ], cards: [makeCard('c1', 'a1', [{ id: 'b1', text: full }, { id: 'b2', text: second }]),
    makeCard('c2', 'a1', [{ id: 'b1', text: full }, { id: 'b2-copy', text: second }]),
    makeCard('c3', 'a2', [{ id: 'b3', text: 'Prepared a weekly summary.' }]) ] };
  db.cards[0].my_actions.push(fact('dialogue1', 'Documented a dashboard handover guide.', 'dialogue'));
  db.cards[0].outcomes.push({ id: 'unconfirmed', note: 'Revenue increase', value: 30, unit: '%', basis: null, status: 'ai_inferred', source: 'dialogue' });
  const jd = { role_title: 'Analyst', domain: 'Data', seniority: 'Junior', requirements: [{ id: 'r1', text: 'Python analysis', kind: 'must_have', priority: 'high', keywords: ['python'] }] };
  const gaps = [{ requirement_id: 'r1', status: 'weak', evidence_fact_ids: ['f-c1'], related_card_ids: ['c1'], reason: 'test' }];
  const revised = 'Analyzed survey responses with Python pandas; created neighborhood charts, documented missing values, and presented findings to a supervisor.';
  const proposal = (id, text, source_ids = []) => ({ original_bullet_id: id, text, source_ids });
  const output = { cards: [
    { card_id: 'c1', bullets: [proposal('b1', revised, ['f-c1']), proposal('b1', 'Duplicate truncated proposal.', ['f-c1']),
      proposal(null, 'Documented a dashboard handover guide.', ['dialogue1']), proposal(null, 'Wrote a dashboard handover guide.', ['dialogue1']),
      proposal(null, 'Extra repeated CV fragment.', ['f-c1'])] },
    { card_id: 'c1', bullets: [proposal('b1', 'Second duplicate model card.', ['f-c1'])] },
    { card_id: 'c2', bullets: [proposal('b1', 'Duplicate card proposal.')] },
  ] };
  const rows = normalizeRewrites(db, ['c1', 'c2', 'c3'], output);
  const key = bulletKey('c1', 0, 'b1');
  const review = (choices = {}, sort = 'relevance') => reviewResume(db, jd, gaps, rows, choices, sort);
  const compact = text => text.replace(/\s+/g, ' ');
  test('one review row per original; duplicate cards, split proposals and repeated dialogue collapse', () => {
    assert.equal(rows[0].bullets.length, 3); // two originals + one genuinely new suggestion
    assert.equal(rows[1].bullets.length, 0);
    assert.equal(rows[2].bullets.length, 1); // model omitted this original: still retained
    assert.equal(rows[0].bullets[1].text, second);
  });
  test('no choices retains ALL full originals and omits new suggestions', () => {
    const r = review();
    assert(r.resume.markdown.includes(compact(full)));
    assert(r.resume.markdown.includes(second));
    assert(!r.resume.markdown.includes(revised));
    assert(!r.resume.markdown.includes('dashboard handover'));
    assert.equal(r.resume.experienceBulletCount, 3);
    assert.equal(r.stats.retained, 3);
    assert.equal(r.stats.accepted, 0);
  });
  test('only explicit acceptance replaces its matching original', () => {
    const r = review({ [key]: { text: revised, status: 'accepted' } });
    assert(r.resume.markdown.includes(revised));
    assert(!r.resume.markdown.includes(compact(full)));
    assert(r.resume.markdown.includes(second));
    assert.equal(r.resume.experienceBulletCount, 3);
  });
  test('saving an edit or retracting acceptance restores the whole original', () => {
    const r = review({ [key]: { text: 'Edited but not accepted.', status: 'pending' } });
    assert(r.resume.markdown.includes(compact(full)));
    assert(!r.resume.markdown.includes('Edited but not accepted.'));
  });
  test('explicit exclusion removes only that whole bullet', () => {
    const r = review({ [key]: { text: revised, status: 'excluded' } });
    assert(!r.resume.markdown.includes(revised));
    assert(!r.resume.markdown.includes(compact(full)));
    assert(r.resume.markdown.includes(second));
    assert.equal(r.resume.experienceBulletCount, 2);
  });
  test('invalid accepted edit never replaces the original, and shows a warning', () => {
    const r = review({ [key]: { text: 'Increased revenue by 999%.', status: 'accepted' } });
    assert(r.resume.markdown.includes(compact(full)));
    assert(!r.resume.markdown.includes('999'));
    assert.equal(r.stats.accepted, 0);
    assert(r.resume.warnings.length);
  });
  test('accepted duplicate edits fall back to their own whole originals without losing clauses', () => {
    const secondKey = bulletKey('c1', 1, 'b2');
    const duplicate = 'Duplicate final description.';
    const r = review({ [key]: { text: duplicate, status: 'accepted' }, [secondKey]: { text: duplicate, status: 'accepted' } });
    assert(r.resume.markdown.includes(duplicate));
    assert(r.resume.markdown.includes(second));
    assert.equal(r.resume.experienceBulletCount, 3);
    const collision = review({ [key]: { text: second, status: 'accepted' } });
    assert(collision.resume.markdown.includes(compact(full)));
    assert(collision.resume.markdown.includes(second));
    assert.equal(collision.stats.accepted, 0);
  });
  test('new dialogue bullet requires acceptance; sorting preserves choices and source IDs', () => {
    const newKey = bulletKey('c1', 2);
    const choices = { [key]: { text: revised, status: 'accepted' }, [newKey]: { text: 'Documented a dashboard handover guide.', status: 'accepted' } };
    const a = review(choices), b = review(choices, 'chronological');
    assert.equal(a.stats.accepted, 2); assert.equal(b.stats.accepted, 2);
    assert.equal(a.resume.experienceBulletCount, 4); assert.equal(b.resume.experienceBulletCount, 4);
    assert(b.resume.markdown.indexOf('Recent Lab') < b.resume.markdown.indexOf('Example Lab'));
    assert(a.resume.markdown.indexOf('Example Lab') < a.resume.markdown.indexOf('Recent Lab'));
    assert(b.resume.markdown.includes(revised));
  });
  test('checks still reject unconfirmed facts and unknown sources; original numbers are valid evidence', () => {
    assert(!checkBullet(db, 'Revenue increased by 30%.', ['unconfirmed']).ok);
    assert(!checkBullet(db, 'Something', ['not-real']).ok);
    const original = { id: 'b-number', text: 'Analyzed 12,000 records; checked 3 sources.' };
    const numericDB = structuredClone(db); numericDB.cards[0].original_bullets.push(original);
    assert(checkBullet(numericDB, original.text, [original.id]).ok);
    assert(confirmedFacts(numericDB).some(f => f.id === original.id && f.text === original.text));
  });
  test('identical wording in separate employers remains separate experience', () => {
    const other = structuredClone(db); other.cards[2].original_bullets[0].text = second;
    const r = reviewResume(other, jd, gaps, normalizeRewrites(other, ['c1', 'c3'], { cards: [] }), {});
    assert.equal(r.resume.markdown.split(second).length - 1, 2);
  });

  const mockDB = await parseCV(SAMPLE_CV), mockJD = await analyzeJD('mock');
  const mockGaps = detectGaps(mockDB, mockJD, await matchExperience(mockDB, mockJD), {});
  const ids = rankCards(mockDB, mockJD, mockGaps).filter(r => r.included).map(r => r.card_id);
  const mockRows = await rewriteBullets(mockDB, mockJD, ids);
  test('mock pipeline keeps all 8 sample bullets, including clauses missing from fact fragments', () => {
    const r = reviewResume(mockDB, mockJD, mockGaps, mockRows, {});
    assert.equal(r.resume.experienceBulletCount, 8);
    assert(r.resume.markdown.includes('Built logistic regression models in Python to predict 30-day readmission from 12,000 patient records'));
    assert(!r.resume.markdown.includes('Developed logistic'));
  });
  console.log(`${passed} bullet-review regression cases passed; no paid API calls.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
