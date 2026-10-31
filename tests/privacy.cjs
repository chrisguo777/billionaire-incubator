// Run against a local MOCK server: node tests/privacy.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { z } = require('zod');
const JSZip = require('jszip');
const compiled = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '../lib/privacy.ts'), 'utf8'))
  .replace(/^import .*;$/gm, '').replace(/export /g, '');
const mod = { exports: new Function('z', compiled + '\nreturn { redactText, redactPayload, EMPTY_CONTACT, contactLines, validateContact };')(z) };
const { redactText, redactPayload, EMPTY_CONTACT, contactLines, validateContact } = mod.exports;
const contact = { name: 'Test Person', email: 'test@example.org', phone: '+1 (202) 555-0147', link: 'https://example.org/profile' };
const redacted = redactText(Object.values(contact).join(' / '), contact);
for (const value of Object.values(contact)) assert(!redacted.includes(value));
assert.equal(redactText('Sep 2025 - Apr 2026; AUC 0.81; 12,000 records'), 'Sep 2025 - Apr 2026; AUC 0.81; 12,000 records');
assert(!JSON.stringify(redactPayload({ history: [{ answer: contact.email }], cv: contact.phone }, contact)).includes('test@example.org'));
assert.deepEqual(contactLines('private', contact), ['[YOUR NAME]', '[YOUR EMAIL]', '[YOUR PHONE]']);
assert.equal(validateContact(contact), null);
assert(validateContact(EMPTY_CONTACT));

const base = process.env.DEMO_URL || 'http://127.0.0.1:3000';
async function post(url, body) {
  return fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function step(body) {
  const res = await post('/api/step', body); assert(res.ok, await res.clone().text()); return res.json();
}
(async () => {
  assert.equal((await (await fetch(base + '/api/step')).json()).mode, 'mock', 'Use a MOCK server; tests never spend model credits');
  const { db } = await step({ step: 'parse', cv: 'Synthetic fixture' });
  const { jd } = await step({ step: 'jd', jd: 'Synthetic fixture' });
  const { gaps } = await step({ step: 'analyze', db, jd, asked: {} });
  const { rewritten } = await step({ step: 'finish', db, jd, gaps });
  const choices = {};
  for (const card of rewritten) card.bullets.forEach((b, i) => { if (b.ok) choices[`${card.card_id}:${i}`] = { text: b.text, status: 'accepted' }; });
  assert(Object.keys(choices).length > 0);
  const draft = { db, jd, gaps, rewritten, choices };
  assert.equal((await post('/api/export', { ...draft, mode: 'private', acknowledged: false })).status, 400);
  assert.equal((await post('/api/export', { ...draft, mode: 'full', contact: EMPTY_CONTACT, acknowledged: true })).status, 400);
  assert.equal((await post('/api/export', { ...draft, choices: {}, mode: 'private', acknowledged: true })).status, 400);
  const invalid = structuredClone(draft);
  invalid.rewritten.forEach(c => c.bullets.forEach((b, i) => { b.source_ids = []; invalid.choices[`${c.card_id}:${i}`] = { text: b.text, status: 'accepted' }; }));
  assert.equal((await post('/api/export', { ...invalid, mode: 'private', acknowledged: true })).status, 400);
  for (const mode of ['private', 'full']) {
    const res = await post('/api/export', { ...draft, mode, contact, acknowledged: true });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const bytes = new Uint8Array(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(bytes); const xml = await zip.file('word/document.xml').async('string');
    assert(xml.includes('EDUCATION') && xml.includes('EXPERIENCE'));
    if (mode === 'private') {
      for (const value of Object.values(contact)) assert(!xml.includes(value));
      for (const token of contactLines('private', contact)) assert(xml.includes(token));
      assert.equal((xml.match(/w:highlight w:val="yellow"/g) || []).length, 3);
      assert(res.headers.get('content-disposition').includes(encodeURIComponent('待填写个人信息')));
    } else {
      for (const value of Object.values(contact)) assert(xml.includes(value));
      assert(!xml.includes('[YOUR NAME]')); assert(!xml.includes('w:highlight'));
    }
    if (process.env.PRIVACY_QA_DIR) {
      fs.mkdirSync(process.env.PRIVACY_QA_DIR, { recursive: true });
      fs.writeFileSync(path.join(process.env.PRIVACY_QA_DIR, `${mode}.docx`), bytes);
    }
  }
  console.log('PASS: contact redaction, original dates/numbers, consent, private/full Word, highlights, accepted facts, no-store');
})().catch(e => { console.error(e); process.exitCode = 1; });
