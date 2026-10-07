import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/support/index.html', import.meta.url), 'utf8');
const privacy = await readFile(new URL('../public/privacy/index.html', import.meta.url), 'utf8');
const hrefs = [...html.matchAll(/\bhref="([^"]+)"/g)].map((match) => match[1].replaceAll('&amp;', '&'));

test('public support has stable canonical metadata and reciprocal privacy discovery', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>Support — T Fleets<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/managefleets\.com\/support">/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.ok(hrefs.includes('https://managefleets.com/privacy'));
  assert.match(privacy, /href="https:\/\/managefleets\.com\/support">Support<\/a>/);
  // Adding navigation must not silently convert the existing legal draft into
  // a final policy or invent an operator/contact/effective date.
  assert.match(privacy, /Draft — operator and contact details require verification/);
  assert.match(privacy, /Contact details pending verification/);
});

test('email uses the verified app contact and a minimal safe diagnostics template', () => {
  const mailLinks = hrefs.filter((href) => href.startsWith('mailto:'));
  assert.equal(mailLinks.length, 2);
  for (const href of mailLinks) assert.equal(new URL(href).pathname, 'yusufjonov5060@gmail.com');
  const template = new URL(mailLinks.find((href) => href.includes('?')));
  assert.equal(template.searchParams.get('subject'), 'T Fleets app support');
  const body = template.searchParams.get('body');
  for (const label of ['App version (if known)', 'Device and OS version', 'What happened', 'What I expected', 'time zone', 'Steps to repeat']) assert.ok(body.includes(label));
  assert.match(body, /do not include passwords, verification codes, tokens, payment details, or confidential load documents/);
  assert.match(html, /copy the address above/);
  assert.doesNotMatch(html, /<form\b|<input\b|<textarea\b|<script\b|<iframe\b/i);
  assert.doesNotMatch(html, /24\/7|within \d+ hours|guaranteed response|ticket submitted/i);
});

test('all six help topics work as native accessible disclosures without JavaScript', () => {
  const expected = ['sign-in', 'loads', 'documents', 'maps', 'notifications', 'messages'];
  const actual = [...html.matchAll(/<details class="help-topic" id="([^"]+)">/g)].map((match) => match[1]);
  assert.deepEqual(actual, expected);
  assert.equal([...html.matchAll(/<summary>/g)].length, expected.length);
  for (const match of html.matchAll(/<summary>([\s\S]*?)<\/summary>/g)) assert.doesNotMatch(match[1], /<div\b|<h[1-6]\b/, 'Disclosure labels use phrasing content');
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
  assert.match(html, /<main id="main" tabindex="-1">/);
  assert.match(html, /class="skip-link" href="#main"/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'IDs must be unique');
  for (const href of hrefs.filter((href) => href.startsWith('#'))) assert.ok(ids.includes(href.slice(1)), `Missing target ${href}`);
  for (const match of html.matchAll(/aria-labelledby="([^"]+)"/g)) assert.ok(ids.includes(match[1]));
  for (const match of html.matchAll(/<svg\b[^>]*>/g)) assert.match(match[0], /aria-hidden="true"/);
});

test('support includes responsive/dark/reduced-motion styles and no third-party resources', () => {
  assert.match(html, /@media \(max-width:760px\)/);
  assert.match(html, /@media \(prefers-color-scheme:dark\)/);
  assert.match(html, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(html, /:focus-visible/);
  assert.match(html, /summary:focus-visible \{ outline-offset:-5px; \}/);
  assert.doesNotMatch(html, /\bsrc=|@import|url\(/i);
  for (const href of hrefs.filter((href) => !href.startsWith('#') && !href.startsWith('mailto:'))) assert.equal(new URL(href).origin, 'https://managefleets.com');
  assert.match(html, /Clearing app data or reinstalling can remove local drafts/);
  assert.match(html, /not an emergency service/);
});
