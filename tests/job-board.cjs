// Run with Node 24+: node tests/job-board.cjs (no network or API calls).
const { stripTypeScriptTypes } = require('node:module');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const load = (file, names) => {
  const code = stripTypeScriptTypes(readFileSync(join(__dirname, '../lib', file), 'utf8')).replace(/^import .*;$/gm, '').replace(/export /g, '');
  return new Function(`${code}\nreturn {${names}};`)();
};
const { boardSlugs, parseBoard, filterJobs, boardApiUrl, boardPageUrl } = load('job-board.ts', 'boardSlugs,parseBoard,filterJobs,boardApiUrl,boardPageUrl');
const { detectAts } = load('job-text.ts', 'detectAts');

// Board-name guesses: company name first, then the domain's first label; at most three.
assert.deepEqual(boardSlugs('Stripe', 'stripe.com'), ['stripe']);
assert.deepEqual(boardSlugs('Scale AI', 'scale.com'), ['scaleai', 'scale-ai', 'scale']);
assert.deepEqual(boardSlugs('Ramp Inc.', 'www.ramp.com'), ['ramp']);
assert.deepEqual(boardSlugs('Johnson & Johnson', 'jnj.com'), ['johnsonandjohnson', 'johnson-and-johnson', 'jnj']);
assert.deepEqual(boardSlugs('!!', ''), []);
for (const s of boardSlugs('../../etc', 'x.com')) assert.match(s, /^[a-z0-9][a-z0-9-]*$/);
assert.equal(boardApiUrl('lever', 'palantir'), 'https://api.lever.co/v0/postings/palantir?mode=json');
assert.equal(boardPageUrl('ashby', 'ramp'), 'https://jobs.ashbyhq.com/ramp');

// Greenhouse: link is rebuilt from board + id, because absolute_url often points to the company site.
const gh = parseBoard('greenhouse', 'stripe', { jobs: [
  { id: 8172510, title: ' Data  Analyst ', location: { name: 'Seattle' }, absolute_url: 'https://stripe.com/jobs/search?gh_jid=8172510' },
  { id: 'abc', title: 'Bad id' },
  { id: 2, title: '' },
] });
assert.deepEqual(gh, [{ title: 'Data Analyst', location: 'Seattle', url: 'https://boards.greenhouse.io/stripe/jobs/8172510', source: 'greenhouse' }]);

const leverId = '6ed76ce8-4156-4b60-b120-403538bd66cd';
const lv = parseBoard('lever', 'palantir', [{ id: leverId, text: 'Forward Deployed Engineer', categories: { location: 'New York, NY' } }, { id: 'nope', text: 'x' }]);
assert.deepEqual(lv, [{ title: 'Forward Deployed Engineer', location: 'New York, NY', url: `https://jobs.lever.co/palantir/${leverId}`, source: 'lever' }]);

const ashbyId = '34413f8d-26bf-4bbc-8ade-eb309a0e2245';
const ab = parseBoard('ashby', 'ramp', { jobs: [
  { id: ashbyId, title: 'Software Engineer', location: 'New York, NY', isListed: true },
  { id: '11111111-1111-1111-1111-111111111111', title: 'Hidden role', isListed: false },
] });
assert.deepEqual(ab.map((j) => j.title), ['Software Engineer']);

// Unexpected shapes give no jobs instead of throwing.
for (const kind of ['greenhouse', 'lever', 'ashby']) {
  for (const bad of [null, 'x', 42, {}, { jobs: 'x' }]) assert.deepEqual(parseBoard(kind, 'acme', bad), []);
}

// Every built link is one the existing JD fetch recognises, so choosing a job reads the full posting via the ATS API.
assert.deepEqual(detectAts(gh[0].url), { kind: 'greenhouse', board: 'stripe', jobId: '8172510' });
assert.deepEqual(detectAts(lv[0].url), { kind: 'lever', company: 'palantir', postingId: leverId });
assert.deepEqual(detectAts(ab[0].url), { kind: 'ashby', org: 'ramp', jobId: ashbyId });

// Title autocomplete: all words must match title or location; titles starting with the query come first.
const jobs = [
  { title: 'Senior Data Analyst', location: 'Remote', url: 'a', source: 'lever' },
  { title: 'Data Analyst', location: 'New York', url: 'b', source: 'lever' },
  { title: 'Data Engineer', location: 'New York', url: 'c', source: 'lever' },
  { title: 'Product Designer', location: 'Remote', url: 'd', source: 'lever' },
];
assert.deepEqual(filterJobs(jobs, 'data analyst').map((j) => j.url), ['b', 'a']);
assert.deepEqual(filterJobs(jobs, 'DATA new york').map((j) => j.url), ['b', 'c']);
assert.deepEqual(filterJobs(jobs, 'remote').map((j) => j.url), ['a', 'd']);
assert.deepEqual(filterJobs(jobs, 'nurse'), []);
assert.equal(filterJobs(jobs, '').length, 4);
assert.equal(filterJobs(jobs, '', 2).length, 2);

console.log('job-board tests passed');
