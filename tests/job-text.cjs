// Run with Node 24+: node tests/job-text.cjs (no network or API calls).
const { stripTypeScriptTypes } = require('node:module');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const code = stripTypeScriptTypes(readFileSync(join(__dirname, '../lib/job-text.ts'), 'utf8')).replace(/^import .*;$/gm, '').replace(/export /g, '');
const { isBlockedAddress, decodeEntities, htmlToText, pageTitle, findJobPosting, detectAts } = new Function(code + '\nreturn {isBlockedAddress,decodeEntities,htmlToText,pageTitle,findJobPosting,detectAts};')();

// Addresses the fetcher must refuse (SSRF)
for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '[::1]', '64:ff9b::a00:1', '999.1.1.1', 'localhost']) {
  assert.equal(isBlockedAddress(ip), true, `should block ${ip}`);
}
for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '52.94.236.248', '2606:4700::6810:85e5', '::ffff:8.8.8.8']) {
  assert.equal(isBlockedAddress(ip), false, `should allow ${ip}`);
}

assert.equal(decodeEntities('R&amp;D &lt;b&gt; &#39;x&#39; &#x2014; &nbsp;'), 'R&D <b> \'x\' —  '.replace(' ', ' '));
assert.equal(decodeEntities('&unknown;'), '&unknown;');

const html = `<html><head><title>Data Analyst &amp; BI | Acme</title><style>.x{}</style></head><body>
<nav>Home Jobs</nav><script>alert(1)</script><h1>Data Analyst</h1><p>Build dashboards.</p>
<ul><li>SQL</li><li>Python</li></ul><footer>© Acme</footer></body></html>`;
const text = htmlToText(html);
assert.ok(text.includes('Data Analyst\n'));
assert.ok(text.includes('- SQL\n- Python'));
assert.ok(!/alert|Home Jobs|© Acme|\.x\{\}/.test(text), text);
assert.equal(pageTitle(html), 'Data Analyst & BI | Acme');
assert.equal(pageTitle('<p>no title</p>'), null);

const longDesc = '<p>' + 'Analyze product data and build dashboards. '.repeat(8) + '</p><ul><li>SQL</li></ul>';
const ld = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Organization', name: 'Acme' }, { '@type': 'JobPosting', title: 'Data Analyst', hiringOrganization: { '@type': 'Organization', name: 'Acme' }, description: longDesc }] })}</script>`;
const posting = findJobPosting(`<html>${ld}</html>`);
assert.equal(posting.title, 'Data Analyst');
assert.equal(posting.company, 'Acme');
assert.ok(posting.description.startsWith('Analyze product data'));
assert.ok(posting.description.includes('- SQL'));
// HTML-escaped description, array @type, and a broken block before the good one
const escaped = `<script type="application/ld+json">{bad json</script><script type='application/ld+json'>${JSON.stringify([{ '@type': ['JobPosting'], title: 'X', hiringOrganization: 'Y', description: longDesc.replace(/</g, '&lt;').replace(/>/g, '&gt;') }])}</script>`;
const p2 = findJobPosting(escaped);
assert.equal(p2.company, 'Y');
assert.ok(!p2.description.includes('<p>'));
// Too short to be a real JD → ignored
assert.equal(findJobPosting(`<script type="application/ld+json">{"@type":"JobPosting","title":"x","description":"short"}</script>`), null);
assert.equal(findJobPosting('<p>nothing</p>'), null);

assert.deepEqual(detectAts('https://boards.greenhouse.io/acme/jobs/4012345'), { kind: 'greenhouse', board: 'acme', jobId: '4012345' });
assert.deepEqual(detectAts('https://job-boards.greenhouse.io/acme/jobs/4012345?gh_src=x'), { kind: 'greenhouse', board: 'acme', jobId: '4012345' });
assert.deepEqual(detectAts('https://boards.greenhouse.io/acme?gh_jid=777'), { kind: 'greenhouse', board: 'acme', jobId: '777' });
assert.deepEqual(detectAts('https://jobs.lever.co/acme/0f2d1c3a-1234-4abc-9def-0123456789ab/apply'), { kind: 'lever', company: 'acme', postingId: '0f2d1c3a-1234-4abc-9def-0123456789ab' });
assert.deepEqual(detectAts('https://jobs.ashbyhq.com/acme/0f2d1c3a-1234-4abc-9def-0123456789ab'), { kind: 'ashby', org: 'acme', jobId: '0f2d1c3a-1234-4abc-9def-0123456789ab' });
assert.equal(detectAts('https://www.amazon.jobs/en/jobs/2712345/data-analyst'), null);
assert.equal(detectAts('https://evil.greenhouse.io.attacker.com/acme/jobs/1'), null);
assert.equal(detectAts('not a url'), null);

console.log('job-text tests passed');
