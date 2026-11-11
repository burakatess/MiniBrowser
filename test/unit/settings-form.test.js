'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../../src/renderer/settings-form');

const form = (o = {}) => ({ mode: 'manual', type: 'socks5', host: ' 10.0.0.9 ', port: '1080', bypass: '<local>,\n *.corp', homepage: 'https://a.example/', ...o });

test('form -> yapılandırma', () => {
  assert.deepEqual(f.formToConfig(form()), {
    homepage: 'https://a.example/',
    proxy: { mode: 'manual', type: 'socks5', host: '10.0.0.9', port: 1080, bypass: ['<local>', '*.corp'] },
  });
});

test('yapılandırma -> form -> yapılandırma gidiş-dönüş', () => {
  const cfg = f.formToConfig(form());
  assert.deepEqual(f.formToConfig(f.configToForm(cfg)), cfg);
});

test('hızlı doğrulama hataları', () => {
  assert.deepEqual(f.quickValidate(f.formToConfig(form())), {});
  assert.ok(f.quickValidate(f.formToConfig(form({ host: '' }))).host);
  assert.ok(f.quickValidate(f.formToConfig(form({ host: 'http://x' }))).host);
  assert.ok(f.quickValidate(f.formToConfig(form({ port: '0' }))).port);
  assert.ok(f.quickValidate(f.formToConfig(form({ port: 'abc' }))).port);
  assert.ok(f.quickValidate(f.formToConfig(form({ homepage: 'ftp://x' }))).homepage);
  // manuel değilse host/port zorunlu değil
  assert.deepEqual(f.quickValidate(f.formToConfig(form({ mode: 'system', host: '', port: '' }))), {});
});

test('her tür için açıklama ve varsayılan port var', () => {
  for (const t of ['http', 'https', 'socks5']) {
    assert.ok(f.TYPE_HINTS[t]);
    assert.ok(Number.isInteger(f.DEFAULT_PORTS[t]));
  }
});
