'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../../src/main/proxy');

test('HTTP / HTTPS / SOCKS5 için doğru Electron proxy kuralları üretilir', () => {
  const base = { mode: 'manual', host: 'proxy.corp.local', port: 3128, bypass: ['<local>', '*.corp.local'] };
  assert.deepEqual(p.toElectronProxyConfig({ ...base, type: 'http' }), {
    mode: 'fixed_servers', proxyRules: 'http://proxy.corp.local:3128', proxyBypassRules: '<local>;*.corp.local',
  });
  assert.equal(p.toElectronProxyConfig({ ...base, type: 'https' }).proxyRules, 'https://proxy.corp.local:3128');
  assert.equal(p.toElectronProxyConfig({ ...base, type: 'socks5', port: 1080 }).proxyRules, 'socks5://proxy.corp.local:1080');
});

test('direct ve system modları', () => {
  assert.deepEqual(p.toElectronProxyConfig({ mode: 'direct' }), { mode: 'direct' });
  assert.deepEqual(p.toElectronProxyConfig({ mode: 'system' }), { mode: 'system' });
  // manuel olmayan modda boş host hata vermez
  assert.doesNotThrow(() => p.validateProxySettings({ mode: 'system', host: '' }));
});

test('IPv4 ve IPv6 adresleri', () => {
  assert.equal(p.toElectronProxyConfig({ mode: 'manual', type: 'http', host: '10.0.0.5', port: 8080 }).proxyRules, 'http://10.0.0.5:8080');
  assert.equal(p.toElectronProxyConfig({ mode: 'manual', type: 'socks5', host: '::1', port: 1080 }).proxyRules, 'socks5://[::1]:1080');
  assert.equal(p.toElectronProxyConfig({ mode: 'manual', type: 'socks5', host: '[fe80::1]', port: 1080 }).proxyRules, 'socks5://[fe80::1]:1080');
});

test('port metin olarak verilirse sayıya çevrilir', () => {
  assert.equal(p.validateProxySettings({ mode: 'manual', type: 'http', host: 'a.b', port: '8080' }).port, 8080);
});

for (const [name, input, field] of [
  ['geçersiz mod', { mode: 'auto' }, 'mode'],
  ['desteklenmeyen tür', { mode: 'manual', type: 'socks4', host: 'a.b', port: 1 }, 'type'],
  ['boş host', { mode: 'manual', type: 'http', host: '  ', port: 8080 }, 'host'],
  ['şemalı host', { mode: 'manual', type: 'http', host: 'http://proxy', port: 8080 }, 'host'],
  ['boşluklu host', { mode: 'manual', type: 'http', host: 'pro xy', port: 8080 }, 'host'],
  ['kural enjeksiyonu', { mode: 'manual', type: 'http', host: 'a;https=evil:1', port: 8080 }, 'host'],
  ['geçersiz IPv4', { mode: 'manual', type: 'http', host: '999.1.1.1', port: 8080 }, 'host'],
  ['port 0', { mode: 'manual', type: 'http', host: 'a.b', port: 0 }, 'port'],
  ['port 70000', { mode: 'manual', type: 'http', host: 'a.b', port: 70000 }, 'port'],
  ['ondalık port', { mode: 'manual', type: 'http', host: 'a.b', port: 80.5 }, 'port'],
  ['metin port', { mode: 'manual', type: 'http', host: 'a.b', port: 'abc' }, 'port'],
  ['bypass enjeksiyonu', { mode: 'manual', type: 'http', host: 'a.b', port: 1, bypass: ['x;y'] }, 'bypass'],
  ['bypass boşluk', { mode: 'manual', type: 'http', host: 'a.b', port: 1, bypass: ['a b'] }, 'bypass'],
  ['nesne olmayan', null, 'proxy'],
]) {
  test(`hata: ${name}`, () => {
    assert.throws(() => p.validateProxySettings(input), (err) => err instanceof p.ProxyValidationError && err.field === field);
  });
}

test('bypass listesi normalize edilir', () => {
  assert.deepEqual(p.normalizeBypass('<local>, *.corp.local;10.0.0.0/8\n\n*.corp.local'), ['<local>', '*.corp.local', '10.0.0.0/8']);
  assert.deepEqual(p.normalizeBypass(undefined), []);
});

test('describeProxy kısa açıklama üretir', () => {
  assert.equal(p.describeProxy({ mode: 'manual', type: 'socks5', host: 'h.local', port: 1080 }), 'SOCKS5 h.local:1080');
  assert.match(p.describeProxy({ mode: 'direct' }), /Doğrudan/);
});
