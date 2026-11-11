'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeInput, isAllowedUrl } = require('../../src/main/url');

const S = 'https://search.example/?q=%s';

test('adres çubuğu girdisi normalize edilir', () => {
  assert.equal(normalizeInput('example.com', S), 'https://example.com/');
  assert.equal(normalizeInput('  http://a.example:8080/x?y=1 ', S), 'http://a.example:8080/x?y=1');
  assert.equal(normalizeInput('localhost:3000', S), 'http://localhost:3000/');
  assert.equal(normalizeInput('127.0.0.1:8080/a', S), 'http://127.0.0.1:8080/a');
  assert.equal(normalizeInput('intranet.corp.local/wiki', S), 'https://intranet.corp.local/wiki');
  assert.equal(normalizeInput('about:blank', S), 'about:blank');
});

test('metin aramaya yönlendirilir', () => {
  assert.equal(normalizeInput('proxy nasıl ayarlanır', S), 'https://search.example/?q=proxy%20nas%C4%B1l%20ayarlan%C4%B1r');
  assert.equal(normalizeInput('electron', S), 'https://search.example/?q=electron');
});

test('tehlikeli şemalar engellenir', () => {
  for (const bad of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,<b>x</b>', 'chrome://settings', 'ftp://x.example/', 'mailto:a@b.c']) {
    assert.equal(normalizeInput(bad, S), null, bad);
  }
  assert.equal(normalizeInput('   ', S), null);
});

test('isAllowedUrl', () => {
  assert.ok(isAllowedUrl('https://a.example/'));
  assert.ok(isAllowedUrl('about:blank'));
  assert.ok(!isAllowedUrl('file:///etc/passwd'));
  assert.ok(!isAllowedUrl('not a url'));
});
