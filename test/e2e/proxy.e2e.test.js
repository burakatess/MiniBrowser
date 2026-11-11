'use strict';
/**
 * Uçtan uca testler: gerçek Electron/Chromium süreci başlatılır, yerel
 * HTTP ve SOCKS5 proxy sunucuları üzerinden sayfa yüklenir.
 * ".test" alan adı DNS'te yoktur; sayfanın açılması trafiğin proxy'den
 * geçtiğini kanıtlar.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTargetServer, startHttpProxy, startSocks5Proxy, findClosedPort } = require('../helpers/servers');
const { makeDataDir, runApp } = require('../helpers/run-app');

const FAKE_HOST = 'minibrowser-e2e.test';
let target;

test.before(async () => {
  target = await startTargetServer();
});
test.after(() => target.close());

const manual = (type, port, extra = {}) => ({
  homepage: `http://${FAKE_HOST}/`,
  proxy: { mode: 'manual', type, host: '127.0.0.1', port, bypass: [], ...extra },
});

test('doğrudan bağlantı: yerel sayfa yüklenir, ayrı profil veri klasöründe oluşur', async () => {
  const dataDir = makeDataDir({ homepage: `http://127.0.0.1:${target.port}/`, proxy: { mode: 'direct' } });
  const { exitCode, result } = await runApp({ dataDir });
  assert.equal(exitCode, 0, JSON.stringify(result));
  assert.equal(result.ok, true);
  assert.equal(result.title, 'MiniBrowser E2E');
  assert.equal(result.resolvedProxy, 'DIRECT');
  assert.equal(path.resolve(result.userData), path.resolve(dataDir, 'profile'));
  assert.ok(fs.readdirSync(path.join(dataDir, 'profile')).length > 0, 'Chromium profil dosyaları yazılmalı');
  assert.ok(fs.existsSync(path.join(dataDir, 'logs', 'minibrowser.log')));
});

test('HTTP proxy üzerinden sayfa yüklenir', async () => {
  const proxy = await startHttpProxy(target.port);
  try {
    const dataDir = makeDataDir(manual('http', proxy.port));
    const { result } = await runApp({ dataDir });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.resolvedProxy, `PROXY 127.0.0.1:${proxy.port}`);
    assert.match(result.body, new RegExp(`host=${FAKE_HOST}`));
    assert.ok(proxy.log.some((r) => r.url === `http://${FAKE_HOST}/`), JSON.stringify(proxy.log));
  } finally {
    await proxy.close();
  }
});

test('SOCKS5 proxy üzerinden sayfa yüklenir (DNS proxy tarafında çözülür)', async () => {
  const socks = await startSocks5Proxy(target.port);
  try {
    const dataDir = makeDataDir(manual('socks5', socks.port));
    const { result } = await runApp({ dataDir });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.resolvedProxy, `SOCKS5 127.0.0.1:${socks.port}`);
    assert.ok(socks.log.some((c) => c.host === FAKE_HOST && c.port === 80 && c.atyp === 3), JSON.stringify(socks.log));
  } finally {
    await socks.close();
  }
});

test('HTTPS proxy türü Chromium\'a doğru kural olarak iletilir', async () => {
  const dataDir = makeDataDir(manual('https', 8443));
  const { result } = await runApp({ dataDir, url: 'about:blank' });
  assert.equal(result.proxy.proxyRules, 'https://127.0.0.1:8443');
  assert.equal(result.resolvedProxy, 'HTTPS 127.0.0.1:8443');
});

test('bypass listesi: eşleşen adres proxy\'siz açılır', async () => {
  const proxy = await startHttpProxy(target.port);
  try {
    const dataDir = makeDataDir({
      homepage: `http://127.0.0.1:${target.port}/`,
      proxy: { mode: 'manual', type: 'http', host: '127.0.0.1', port: proxy.port, bypass: ['127.0.0.1'] },
    });
    const { result } = await runApp({ dataDir });
    assert.equal(result.ok, true);
    assert.equal(result.resolvedProxy, 'DIRECT');
    assert.equal(proxy.log.length, 0);
  } finally {
    await proxy.close();
  }
});

test('erişilemeyen proxy: ERR_PROXY_CONNECTION_FAILED raporlanır', async () => {
  const closed = await findClosedPort();
  const dataDir = makeDataDir(manual('http', closed));
  const { exitCode, result } = await runApp({ dataDir });
  assert.notEqual(exitCode, 0);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, -130, JSON.stringify(result));
});

test('bozuk yapılandırma: yedeklenir, varsayılanlarla açılır, uyarı verilir', async () => {
  const dataDir = makeDataDir('{ bu geçerli JSON değil');
  const { result } = await runApp({ dataDir, url: `http://127.0.0.1:${target.port}/` });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.warning, /varsayılanlara sıfırlandı/);
  assert.ok(fs.readdirSync(dataDir).some((n) => n.startsWith('config.json.corrupt-')));
  const cfg = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
  assert.equal(cfg.proxy.mode, 'system');
});

test('yazılamayan veri klasörü: başlatma anlaşılır hatayla durur', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const parent = makeDataDir();
  fs.chmodSync(parent, 0o500);
  try {
    const { exitCode, result } = await runApp({ dataDir: path.join(parent, 'data') });
    assert.equal(exitCode, 1);
    assert.equal(result.stage, 'startup');
    assert.match(result.error, /oluşturulamadı|yazılamıyor/);
  } finally {
    fs.chmodSync(parent, 0o700);
  }
});
