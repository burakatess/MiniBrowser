'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { describeNetError, isProxyError } = require('../../src/main/errors');

test('proxy hata kodları tanınır', () => {
  assert.ok(isProxyError(-130));
  assert.ok(isProxyError('-120'));
  assert.ok(!isProxyError(-105));
  assert.match(describeNetError(-130, 'ERR_PROXY_CONNECTION_FAILED').title, /Proxy/);
});

test('bilinmeyen kod için genel mesaj', () => {
  const d = describeNetError(-9999, 'ERR_X');
  assert.equal(d.title, 'Sayfa yüklenemedi');
  assert.equal(d.code, -9999);
});
