// Node 24+, no model calls: node tests/language.cjs
// 沟通语言只影响追问；简历目标语言按上传简历自动识别，最终简历里的非目标语言内容会被列成警告。
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
  const { detectLanguage, isForeign } = await import('../lib/language.ts');
  const { parseCV, askQuestion, assembleResume, languageWarnings } = await import('../lib/pipeline.ts');
  let passed = 0;
  const test = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name); };

  await test('resume language is detected from the uploaded text', () => {
    assert.equal(detectLanguage('EXPERIENCE\n- Built dashboards in Tableau for 5 clinic managers'), 'en');
    assert.equal(detectLanguage('工作经历\n- 使用 Python 和 SQL 清洗 12 个监测点的数据，搭建 Tableau 看板'), 'zh');
    assert.equal(detectLanguage('李子悦 Ziyue Li\nEXPERIENCE\nBuilt regression models in R to assess water quality'), 'en');
  });

  await test('foreign-text rule: any Han in English, English-dominant sentences in Chinese', () => {
    assert.equal(isForeign('负责整理监测数据', 'en'), true);
    assert.equal(isForeign('Built regression models in R', 'en'), false);
    assert.equal(isForeign('使用 Python 和 SQL 清洗数据', 'zh'), false);
    assert.equal(isForeign('Built regression models in R to assess pollution', 'zh'), true);
  });

  await test('parsing stores the target language on the experience database', async () => {
    const db = await parseCV('ignored in mock mode');
    assert.equal(db.resume_language, 'en');
  });

  await test('questions follow the chat language, independent of the resume language', async () => {
    const gap = { requirement_id: 'r1', status: 'unknown', evidence_fact_ids: [], related_card_ids: [], reason: 'test' };
    const req = { id: 'r1', text: 'Strong SQL skills', kind: 'must_have', priority: 'high', keywords: ['sql'] };
    const db = { affiliations: [], cards: [], education: [], resume_language: 'en' };
    assert.match(await askQuestion(db, gap, req, [], 'zh'), /\p{Script=Han}/u);
    assert.doesNotMatch(await askQuestion(db, gap, req, [], 'en'), /\p{Script=Han}/u);
  });

  const jd = { role_title: 'Data Analyst', domain: 'Data', seniority: 'Junior', requirements: [{ id: 'r1', text: 'SQL', kind: 'must_have', priority: 'high', keywords: ['sql'] }] };
  const fact = (id, text) => ({ id, text, status: 'user_confirmed', source: 'dialogue' });
  const makeDb = (lang) => ({
    resume_language: lang,
    education: [],
    affiliations: [
      { id: 'a1', organization: 'Example Lab', title: 'Analyst', type: 'work', start_date: '2025', end_date: '2026' },
      { id: 'a2', organization: 'Added during interview', title: null, type: 'other', start_date: null, end_date: null },
    ],
    cards: [
      { id: 'c1', affiliation_id: 'a1', name: 'Survey analysis', my_role: null, context: [], my_actions: [fact('f1', 'x')], team_actions: [], methods: [], tools: [], skills: [], scale: [], outcomes: [] },
      { id: 'c2', affiliation_id: 'a2', name: 'Dashboard project', my_role: null, context: [], my_actions: [fact('f2', 'y')], team_actions: [], methods: [], tools: [], skills: [], scale: [], outcomes: [] },
    ],
  });
  const rewritten = [
    { card_id: 'c1', bullets: [
      { text: 'Cleaned survey data with SQL', source_ids: ['f1'], ok: true, issues: [] },
      { text: '用 SQL 整理了 12 个监测点的数据', source_ids: ['f1'], ok: true, issues: [] },
    ] },
    { card_id: 'c2', bullets: [{ text: 'Built a weekly dashboard', source_ids: ['f2'], ok: true, issues: [] }] },
  ];

  await test('English resume: headings stay English and a Chinese bullet is flagged', () => {
    const out = assembleResume(makeDb('en'), jd, [], rewritten);
    assert.equal(out.doc.title, 'Targeted resume — Data Analyst');
    assert.deepEqual(out.doc.sections.map((s) => s.heading), ['EXPERIENCE']);
    const flagged = out.warnings.filter((w) => w.includes('不是简历目标语言'));
    assert.equal(flagged.length, 1);
    assert(flagged[0].includes('用 SQL 整理了 12 个监测点的数据'));
  });

  await test('Chinese resume: headings are Chinese and an English sentence is flagged', () => {
    const out = assembleResume(makeDb('zh'), jd, [], rewritten);
    assert.equal(out.doc.title, '定向简历 — Data Analyst');
    assert.deepEqual(out.doc.sections.map((s) => s.heading), ['经历']);
    const flagged = out.warnings.filter((w) => w.includes('不是简历目标语言'));
    assert.equal(flagged.length, 2, 'the two English bullets are flagged; the Chinese one is not');
  });

  await test('the internal "Added during interview" group never appears in the resume', () => {
    const out = assembleResume(makeDb('en'), jd, [], rewritten);
    assert(!out.markdown.includes('Added during interview'));
  });

  await test('no warnings when everything is already in the target language', () => {
    const doc = { title: 'Targeted resume — X', sections: [{ heading: 'EXPERIENCE', text: null, entries: [{ title: 'Lab', location: null, subtitle: 'Analyst', dates: '2025', bullets: ['Built dashboards in Tableau'] }] }] };
    assert.deepEqual(languageWarnings(doc, 'en'), []);
  });

  console.log(`${passed} language regression cases passed; no paid API calls.`);
})().catch((err) => { console.error(err); process.exit(1); });
