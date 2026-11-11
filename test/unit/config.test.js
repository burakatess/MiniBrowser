'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const c = require('../../src/main/config');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mb-cfg-')), 'config.json');

test('dosya yoksa varsayılanlarla oluşturulur', () => {
  const f = tmpFile();
  const r = c.loadConfig(f);
  assert.equal(r.created, true);
  assert.equal(r.warning, null);
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), r.config);
  assert.equal(r.config.proxy.mode, 'system');
});

test('kaydet / yükle döngüsü', () => {
  const f = tmpFile();
  c.saveConfig(f, { homepage: 'https://intranet.local/', proxy: { mode: 'manual', type: 'socks5', host: '127.0.0.1', port: 1080 } });
  const r = c.loadConfig(f);
  assert.equal(r.config.homepage, 'https://intranet.local/');
  assert.equal(r.config.proxy.type, 'socks5');
  assert.equal(r.config.proxy.port, 1080);
  assert.ok(!fs.readdirSync(path.dirname(f)).some((n) => n.endsWith('.tmp')), 'geçici dosya kalmamalı');
});

test('bozuk JSON yedeklenir ve varsayılanlara dönülür', () => {
  const f = tmpFile();
  fs.writeFileSync(f, '{ "proxy": { "mode": "manual", ');
  const r = c.loadConfig(f, { now: () => 42 });
  assert.match(r.warning, /JSON sözdizimi hatası/);
  assert.ok(fs.existsSync(`${f}.corrupt-42`));
  assert.equal(fs.readFileSync(`${f}.corrupt-42`, 'utf8'), '{ "proxy": { "mode": "manual", ');
  assert.equal(r.config.proxy.mode, 'system');
});

test('geçersiz değerler (ör. port) yedeklenip sıfırlanır', () => {
  const f = tmpFile();
  fs.writeFileSync(f, JSON.stringify({ proxy: { mode: 'manual', type: 'http', host: 'p.local', port: 99999 } }));
  const r = c.loadConfig(f, { now: () => 7 });
  assert.match(r.warning, /Port/);
  assert.ok(fs.existsSync(`${f}.corrupt-7`));
});

test('UTF-8 BOM içeren dosya (Not Defteri) okunur', () => {
  const f = tmpFile();
  fs.writeFileSync(f, '\uFEFF' + JSON.stringify({ homepage: 'https://a.example/' }));
  assert.equal(c.loadConfig(f).config.homepage, 'https://a.example/');
});

test('doğrulama hataları alan adıyla ConfigError fırlatır', () => {
  const cases = [
    [{ homepage: 'javascript:alert(1)' }, 'homepage'],
    [{ homepage: 'file:///C:/Windows' }, 'homepage'],
    [{ searchUrl: 'https://s.example/?q=' }, 'searchUrl'],
    [{ version: 2 }, 'version'],
    [{ proxy: { mode: 'manual', host: '' } }, 'proxy.host'],
    [[], 'root'],
  ];
  for (const [input, field] of cases) {
    assert.throws(() => c.validateConfig(input), (e) => e instanceof c.ConfigError && e.field === field, JSON.stringify(input));
  }
});

test('pencere boyutu sınırlandırılır', () => {
  const v = c.validateConfig({ window: { width: 10, height: 999999 } });
  assert.deepEqual(v.window, { width: 400, height: 10000 });
});

test('config/default.config.json geçerli ve koddaki varsayılanlarla aynı', () => {
  const file = path.join(__dirname, '..', '..', 'config', 'default.config.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(c.validateConfig(parsed), c.validateConfig(c.DEFAULT_CONFIG));
});
