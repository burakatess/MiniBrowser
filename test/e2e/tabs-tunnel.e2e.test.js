'use strict';
/** Çoklu sekme ve VPN (SSH tüneli) uçtan uca testleri — gerçek Electron/Chromium. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTargetServer, findClosedPort } = require('../helpers/servers');
const { makeDataDir, runApp } = require('../helpers/run-app');
const { makeFakeSsh } = require('../helpers/fake-ssh-wrapper');

const FAKE_HOST = 'minibrowser-e2e.test';
let target;
test.before(async () => (target = await startTargetServer()));
test.after(() => target.close());

const jsonFile = (obj) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mb-scn-')), 's.json');
  fs.writeFileSync(f, JSON.stringify(obj));
  return f;
};
const shots = process.env.MINIBROWSER_SCREENSHOTS || null;

test('sekmeler: +, window.open, kısayollar, tıklama, kapatma, geri açma', async () => {
  const base = `http://127.0.0.1:${target.port}/`;
  const dataDir = makeDataDir({ homepage: base, proxy: { mode: 'direct' } });
  const { result } = await runApp({ dataDir, url: base, extraArgs: [`--smoke-tabs=${jsonFile({ screenshotDir: shots })}`] });
  assert.equal(result.ok, true, JSON.stringify(result));
  const t = result.tabs;
  const [a] = t.afterPlus.order;

  assert.equal(t.afterPlus.order.length, 2);
  assert.equal(t.afterPlus.activeId, t.afterPlus.order[1], '+ ile açılan sekme etkin');
  assert.equal(t.afterPlus.dom.length, 2, 'sekme şeridinde 2 sekme');
  assert.equal(t.afterPlus.dom.filter((d) => d.active).length, 1);

  assert.equal(t.afterWindowOpen.order.length, 3);
  const [, b, c] = t.afterWindowOpen.order;
  assert.equal(t.afterWindowOpen.activeId, c, 'window.open yeni sekmede ve etkin');
  assert.equal(t.afterWindowOpen.dom.find((d) => d.active).title, 'MiniBrowser E2E', 'sekme başlığı sayfa başlığından');

  assert.equal(t.afterCtrl1, a);
  assert.equal(t.afterCtrlTab, b);
  assert.equal(t.afterCtrl9, c);
  assert.equal(t.afterClickFirst, a);

  assert.deepEqual(t.afterCloseMiddle.order, [a, c], '× ortadaki sekmeyi kapatır');
  assert.equal(t.afterCloseMiddle.activeId, a, 'etkin olmayan sekme kapanınca etkin değişmez');
  assert.deepEqual(t.afterCtrlW.order, [c], 'Ctrl+W etkin sekmeyi kapatır');
  assert.equal(t.afterCtrlW.activeId, c);

  assert.equal(t.afterReopen.order.length, 2, 'Ctrl+Shift+T sekmeyi geri açar');
  assert.equal(t.afterReopen.url, base, 'son kapatılan sekmenin adresi');
});

test('VPN: SSH tüneli üzerinden sayfa yüklenir, kopunca trafik tünelsiz akmaz, kapatınca normale döner', { skip: process.platform === 'win32' }, async () => {
  const fake = makeFakeSsh({ targetPort: target.port });
  const dataDir = makeDataDir({
    homepage: `http://${FAKE_HOST}/`,
    proxy: { mode: 'direct' },
    tunnel: { host: 'tunel.ornek.test', port: 2222, user: 'ali', sshPath: fake.sshPath },
  });
  const { result } = await runApp({
    dataDir,
    url: `http://${FAKE_HOST}/`,
    extraArgs: [`--smoke-tunnel=${jsonFile({ crash: true, screenshotDir: shots })}`],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const r = result.tunnel;
  const port = r.statusAfterConnect.localPort;

  assert.equal(r.before, 'DIRECT');
  assert.equal(r.statusAfterConnect.state, 'connected', JSON.stringify(r.statusAfterConnect));
  assert.equal(r.during, `SOCKS5 127.0.0.1:${port}`);
  assert.equal(r.page.ok, true, JSON.stringify(r.page));
  assert.match(r.page.body, new RegExp(`host=${FAKE_HOST}`), 'DNS\'te olmayan alan adı yalnızca tünelden açılabilir');
  assert.equal(r.vpnButton.text, 'VPN açık');
  assert.match(r.vpnButton.cls, /connected/);

  const args = fake.readArgs();
  assert.equal(args.host, 'tunel.ornek.test');
  assert.equal(args.user, 'ali');
  assert.ok(args.args.includes('2222'));
  assert.ok(args.args.some((a) => a === `UserKnownHostsFile=${path.join(dataDir, 'ssh', 'known_hosts')}`), 'uygulamaya özel known_hosts');

  // Kill switch
  assert.equal(r.statusAfterCrash.state, 'error');
  assert.equal(r.statusAfterCrash.wanted, true);
  assert.equal(r.afterCrashProxy, `SOCKS5 127.0.0.1:${port}`, 'proxy tünel portunda kalır');
  assert.equal(r.pageAfterCrash.ok, false, 'tünel kopunca sayfa doğrudan yüklenmez');
  assert.ok([-120, -130, -102].includes(r.pageAfterCrash.errorCode), JSON.stringify(r.pageAfterCrash));

  assert.equal(r.statusAfterDisconnect.state, 'idle');
  assert.equal(r.statusAfterDisconnect.wanted, false);
  assert.equal(r.after, 'DIRECT', 'kapatınca normal proxy ayarına dönülür');
  assert.deepEqual(r.states.slice(0, 2), ['connecting', 'connected']);
});

test('VPN: tünel açıkken kullanıcının proxy ayarı geçersiz kılınır, kapatınca geri gelir', { skip: process.platform === 'win32' }, async () => {
  // Kullanıcının proxy'si kapalı bir porta işaret ediyor: sayfa yalnızca tünel
  // proxy'nin yerine geçerse açılabilir.
  const deadProxy = await findClosedPort();
  const fake = makeFakeSsh({ targetPort: target.port });
  const dataDir = makeDataDir({
    homepage: `http://${FAKE_HOST}/`,
    proxy: { mode: 'manual', type: 'http', host: '127.0.0.1', port: deadProxy, bypass: [] },
    tunnel: { host: 'tunel.ornek.test', user: 'ali', sshPath: fake.sshPath },
  });
  const { result } = await runApp({ dataDir, url: `http://${FAKE_HOST}/`, extraArgs: [`--smoke-tunnel=${jsonFile({ crash: false })}`] });
  const r = result.tunnel;
  assert.equal(r.before, `PROXY 127.0.0.1:${deadProxy}`);
  assert.match(r.during, /^SOCKS5 127\.0\.0\.1:/);
  assert.equal(r.page.ok, true, 'sayfa tünel üzerinden açıldı (kullanıcı proxy\'si kullanılmadı)');
  assert.equal(r.after, `PROXY 127.0.0.1:${deadProxy}`, 'kapatınca kullanıcı proxy\'sine dönülür');
});

test('VPN: kimlik doğrulama hatası kullanıcıya gösterilir ve trafik engelli kalır', { skip: process.platform === 'win32' }, async () => {
  const fake = makeFakeSsh({ targetPort: target.port });
  const dataDir = makeDataDir({
    homepage: `http://${FAKE_HOST}/`,
    proxy: { mode: 'direct' },
    tunnel: { host: 'fail-auth.test', user: 'ali', sshPath: fake.sshPath },
  });
  const { result } = await runApp({ dataDir, url: `http://${FAKE_HOST}/`, extraArgs: [`--smoke-tunnel=${jsonFile({ crash: false })}`] });
  const r = result.tunnel;
  assert.equal(r.statusAfterConnect.state, 'error');
  assert.match(r.statusAfterConnect.message, /Kimlik doğrulama başarısız/);
  assert.equal(r.vpnButton.text, 'VPN hatası');
  assert.equal(r.page.ok, false, 'tünel kurulamadıysa sayfa tünelsiz açılmaz');
  assert.ok([-120, -130, -102].includes(r.page.errorCode), `proxy (tünel portu) hatası beklenir, DNS hatası değil: ${r.page.errorCode}`);
  assert.match(r.during, /^SOCKS5 127\.0\.0\.1:/, 'kill switch: trafik tünel portunda');
  assert.equal(r.after, 'DIRECT', 'kapatınca normale döner');
});
