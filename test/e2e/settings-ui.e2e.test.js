'use strict';
/** Proxy ayar ekranının (HTML/CSS/JS) gerçek Electron penceresinde testleri. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTargetServer, startSocks5Proxy, startHttpProxy, findClosedPort } = require('../helpers/servers');
const { makeDataDir, runApp } = require('../helpers/run-app');

let target;
test.before(async () => (target = await startTargetServer()));
test.after(() => target.close());

function scenario(obj) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mb-scn-')), 'scenario.json');
  fs.writeFileSync(f, JSON.stringify(obj));
  return f;
}
const run = (dataDir, scn) =>
  runApp({ dataDir, url: `http://127.0.0.1:${target.port}/`, extraArgs: [`--smoke-settings=${scenario(scn)}`] });

test('ayar ekranı mevcut yapılandırmayı gösterir ve SOCKS5 ayarını kaydeder', async () => {
  const socks = await startSocks5Proxy(target.port);
  try {
    const dataDir = makeDataDir({ proxy: { mode: 'system' } });
    const shots = process.env.MINIBROWSER_SCREENSHOTS || null;
    const { result } = await run(dataDir, {
      action: 'save',
      screenshotDir: shots,
      values: { mode: 'manual', type: 'socks5', host: '127.0.0.1', port: String(socks.port), bypass: '<local>, *.corp.local', homepage: 'http://minibrowser-e2e.test/' },
    });
    const s = result.settings;
    assert.equal(s.loaded.mode, 'system');
    assert.match(s.resultClass, /\bok\b/, JSON.stringify(s));
    assert.deepEqual(s.savedConfig.proxy, { mode: 'manual', type: 'socks5', host: '127.0.0.1', port: socks.port, bypass: ['<local>', '*.corp.local'] });
    assert.equal(s.toolbarBadge, `Proxy: SOCKS5 127.0.0.1:${socks.port}`);
  } finally {
    await socks.close();
  }
});

test('ayar ekranı geçersiz portu kaydetmeden reddeder', async () => {
  const dataDir = makeDataDir({ proxy: { mode: 'direct' } });
  const { result } = await run(dataDir, { action: 'save', values: { mode: 'manual', type: 'http', host: 'proxy.local', port: '70000' } });
  assert.match(result.settings.errors['err-port'], /1–65535/);
  assert.equal(result.settings.savedConfig.proxy.mode, 'direct', 'dosya değişmemeli');
});

test('ayar ekranı kural enjeksiyonunu sunucu tarafında reddeder', async () => {
  const dataDir = makeDataDir({ proxy: { mode: 'direct' } });
  const { result } = await run(dataDir, { action: 'save', values: { mode: 'manual', type: 'http', host: 'a.local;https=evil.example', port: '8080' } });
  assert.match(result.settings.errors['err-host'], /Geçersiz proxy sunucusu/);
  assert.match(result.settings.resultClass, /\berr\b/);
  assert.equal(result.settings.savedConfig.proxy.mode, 'direct');
});

test('"Bağlantıyı test et": çalışan HTTP proxy başarılı, kapalı proxy başarısız', async () => {
  const proxy = await startHttpProxy(target.port);
  try {
    const okRun = await run(makeDataDir({}), {
      action: 'test',
      values: { mode: 'manual', type: 'http', host: '127.0.0.1', port: String(proxy.port), bypass: '', homepage: 'http://minibrowser-e2e.test/' },
    });
    assert.match(okRun.result.settings.resultText, /Bağlantı başarılı.*HTTP 200/, JSON.stringify(okRun.result.settings));
    assert.match(okRun.result.settings.resultText, new RegExp(`PROXY 127.0.0.1:${proxy.port}`));
  } finally {
    await proxy.close();
  }
  const closed = await findClosedPort();
  const badRun = await run(makeDataDir({}), {
    action: 'test',
    values: { mode: 'manual', type: 'http', host: '127.0.0.1', port: String(closed), bypass: '', homepage: 'http://minibrowser-e2e.test/' },
  });
  assert.match(badRun.result.settings.resultText, /Bağlantı başarısız/);
  assert.match(badRun.result.settings.resultClass, /\berr\b/);
});
