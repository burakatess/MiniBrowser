'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../../src/renderer/settings-form');

const form = (o = {}) => ({ mode: 'manual', type: 'socks5', host: ' 10.0.0.9 ', port: '1080', bypass: '<local>,\n *.corp', homepage: 'https://a.example/', ...o });

test('form -> yapılandırma', () => {
  const c = f.formToConfig(form());
  assert.equal(c.homepage, 'https://a.example/');
  assert.deepEqual(c.proxy, { mode: 'manual', type: 'socks5', host: '10.0.0.9', port: 1080, bypass: ['<local>', '*.corp'] });
  assert.deepEqual(c.tunnel, { host: '', port: 22, user: '', identityFile: '', localPort: 0, autoConnect: false, sshPath: '' });
});

test('tünel alanları form -> yapılandırma', () => {
  const c = f.formToConfig(form({ tunnel: { host: ' s.example ', port: '2222', user: 'ali', identityFile: ' /k ', localPort: '18080', autoConnect: true, sshPath: '' } }));
  assert.deepEqual(c.tunnel, { host: 's.example', port: 2222, user: 'ali', identityFile: '/k', localPort: 18080, autoConnect: true, sshPath: '' });
  assert.deepEqual(f.quickValidate(c), {});
});

test('tünel hızlı doğrulama', () => {
  const t = (o) => f.formToConfig(form({ tunnel: { host: 's.example', port: '22', user: 'ali', localPort: '0', ...o } })).tunnel;
  assert.ok(f.quickValidateTunnel(t({ host: 'a b' }))['t-host']);
  assert.ok(f.quickValidateTunnel(t({ port: '0' }))['t-port']);
  assert.ok(f.quickValidateTunnel(t({ user: 'a b' }))['t-user']);
  assert.ok(f.quickValidateTunnel(t({ localPort: '80' }))['t-localPort']);
  assert.deepEqual(f.quickValidateTunnel(t({ host: '', user: '' })), {}, 'kaydetmek için zorunlu değil');
  const forConnect = f.quickValidateTunnel(t({ host: '', user: '' }), { forConnect: true });
  assert.ok(forConnect['t-host'] && forConnect['t-user'], 'bağlanmak için zorunlu');
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
