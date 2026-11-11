'use strict';
/**
 * Statik kontroller: BAT başlatıcısı ve kaynak kodun "kurulum/admin gerektirmeme"
 * ve "güvenlik kontrollerini atlatmama" gereksinimlerine uyduğunu doğrular.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const walk = (dir) =>
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]
  );

test('BAT: CRLF satır sonları ve ASCII (cmd.exe uyumluluğu)', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'MiniBrowser.bat'));
  const text = raw.toString('latin1');
  assert.ok(!/[^\r]\n/.test(text), 'tüm satırlar CRLF ile bitmeli');
  assert.ok([...raw].every((b) => b < 128), 'yalnızca ASCII karakterler');
});

test('BAT: yönetici yetkisi / sistem değişikliği komutu içermez', () => {
  const bat = read('MiniBrowser.bat').toLowerCase();
  const code = bat.split('\r\n').filter((l) => !l.trim().startsWith('rem') && !l.trim().startsWith('echo')).join('\n');
  for (const forbidden of ['runas', 'reg add', 'reg delete', 'setx', 'netsh', 'icacls', 'takeown', 'schtasks', 'sc config', 'powershell', 'msiexec', '--ignore-certificate-errors', '--no-sandbox', '--disable-web-security']) {
    assert.ok(!code.includes(forbidden), `yasak: ${forbidden}`);
  }
});

test('BAT: hata kontrolleri ve ayrı profil argümanı mevcut', () => {
  const bat = read('MiniBrowser.bat');
  assert.match(bat, /--data-dir="%DATA_DIR%"/);
  assert.match(bat, /MiniBrowser\.exe bulunamadi/);
  assert.match(bat, /Veri klasorune yazilamiyor/);
  assert.match(bat, /ZIP arsivinin icinden/);
  assert.match(bat, /setlocal EnableExtensions/);
  assert.match(bat, /:fail[\s\S]*exit \/b 1/);
  // her "goto :x" için ":x" etiketi olmalı
  for (const [, label] of bat.matchAll(/goto :(\w+)/g)) assert.match(bat, new RegExp(`^:${label}\\r?$`, 'm'), label);
  // parantez dengesi
  const code = bat.split('\r\n').filter((l) => !/^\s*(rem|echo)\b/i.test(l)).join('\n');
  assert.equal((code.match(/\(/g) || []).length, (code.match(/\)/g) || []).length);
});

test('Kaynak kod güvenlik ayarlarını gevşetmez', () => {
  const files = walk('src').filter((f) => /\.(js|html)$/.test(f));
  for (const f of files) {
    const s = read(f);
    assert.ok(!/nodeIntegration:\s*true/.test(s), `${f}: nodeIntegration true`);
    assert.ok(!/contextIsolation:\s*false/.test(s), `${f}: contextIsolation false`);
    assert.ok(!/sandbox:\s*false/.test(s), `${f}: sandbox false`);
    assert.ok(!/webSecurity:\s*false/.test(s), `${f}: webSecurity false`);
    assert.ok(!/ignore-certificate-errors|allow-insecure-localhost|disable-web-security|no-sandbox/.test(s), `${f}: güvensiz anahtar`);
    assert.ok(!/certificate-error/.test(s), `${f}: sertifika hatası işleyicisi olmamalı`);
    assert.ok(!/setCertificateVerifyProc/.test(s), `${f}: sertifika doğrulaması değiştirilmemeli`);
    assert.ok(!/child_process|execSync|\bspawn\(/.test(s), `${f}: harici komut çalıştırılmamalı`);
  }
});

test('Paketleme: Windows asInvoker / kullanıcı seviyesi', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.build.win.requestedExecutionLevel, 'asInvoker');
  assert.equal(pkg.build.portable.requestExecutionLevel, 'user');
  assert.ok(pkg.build.win.target.includes('portable'));
});

test('Tüm HTML sayfalarında CSP var ve satır içi script yok', () => {
  for (const f of walk('src/renderer').filter((x) => x.endsWith('.html'))) {
    const s = read(f);
    assert.match(s, /Content-Security-Policy/, f);
    assert.ok(!/<script>(?!\s*<\/script>)/.test(s), `${f}: inline script`);
    assert.ok(!/\son[a-z]+="/i.test(s), `${f}: inline olay işleyicisi`);
    for (const [, src] of s.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
      assert.ok(fs.existsSync(path.join(ROOT, path.dirname(f), src)), `${f}: eksik ${src}`);
    }
  }
});

test('main.js içinde başvurulan sayfa ve preload dosyaları mevcut', () => {
  const main = read('src/main/main.js');
  for (const [, file] of main.matchAll(/'([\w-]+\.(?:html|js))'/g)) {
    const ok = ['src/renderer', 'src/preload', 'src/main'].some((d) => fs.existsSync(path.join(ROOT, d, file)));
    assert.ok(ok, file);
  }
});
