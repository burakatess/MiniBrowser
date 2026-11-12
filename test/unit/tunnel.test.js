'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const t = require('../../src/main/tunnel');
const { startSocks5Proxy, findClosedPort } = require('../helpers/servers');
const { makeFakeSsh } = require('../helpers/fake-ssh-wrapper');

const base = { host: 'sunucu.ornek.com', port: 22, user: 'ali', identityFile: '', localPort: 0, autoConnect: false, sshPath: '' };

test('ssh argümanları: yerel SOCKS, BatchMode, host key doğrulaması, kabuk yok', () => {
  const args = t.buildSshArgs({ ...base, port: 2222 }, { localPort: 18080, knownHostsFile: '/d/ssh/known_hosts' });
  assert.deepEqual(args, [
    '-N', '-T',
    '-D', '127.0.0.1:18080',
    '-p', '2222',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ConnectTimeout=15',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'UserKnownHostsFile=/d/ssh/known_hosts',
    '-l', 'ali', '--', 'sunucu.ornek.com',
  ]);
  for (const forbidden of ['StrictHostKeyChecking=no', 'ProxyCommand', 'ProxyJump', 'GatewayPorts', '-g', '-R']) {
    assert.ok(!args.includes(forbidden) && !args.some((a) => a.startsWith(forbidden)), forbidden);
  }
});

test('anahtar dosyası verilirse IdentitiesOnly ile eklenir', () => {
  const args = t.buildSshArgs({ ...base, identityFile: 'C:\\Users\\ali\\.ssh\\id_ed25519' }, { localPort: 1, knownHostsFile: 'k' });
  const i = args.indexOf('-i');
  assert.equal(args[i + 1], 'C:\\Users\\ali\\.ssh\\id_ed25519');
  assert.ok(args.includes('IdentitiesOnly=yes'));
  assert.ok(i < args.indexOf('--'), 'seçenekler -- ayırıcısından önce');
});

for (const [name, input, field] of [
  ['seçenek gibi host', { host: '-oProxyCommand=calc' }, 'host'],
  ['boşluklu host', { host: 'a b' }, 'host'],
  ['geçersiz port', { port: 0 }, 'port'],
  ['seçenek gibi kullanıcı', { user: '-oX' }, 'user'],
  ['boşluklu kullanıcı', { user: 'a b' }, 'user'],
  ['seçenek gibi anahtar yolu', { identityFile: '-oX=1' }, 'identityFile'],
  ['satır sonlu anahtar yolu', { identityFile: 'a\nb' }, 'identityFile'],
  ['ayrıcalıklı yerel port', { localPort: 80 }, 'localPort'],
  ['geçersiz yerel port', { localPort: 70000 }, 'localPort'],
  ['seçenek gibi ssh yolu', { sshPath: '-x' }, 'sshPath'],
]) {
  test(`tünel doğrulama hatası: ${name}`, () => {
    assert.throws(() => t.validateTunnelSettings({ ...base, ...input }), (e) => e instanceof t.TunnelValidationError && e.field === field);
  });
}

test('bağlanmak için host ve kullanıcı zorunlu; kayıt için değil', () => {
  assert.doesNotThrow(() => t.validateTunnelSettings({ ...base, host: '', user: '' }));
  assert.throws(() => t.validateTunnelSettings({ ...base, host: '' }, { requireComplete: true }), /sunucusu zorunlu/);
  assert.throws(() => t.validateTunnelSettings({ ...base, user: '' }, { requireComplete: true }), /kullanıcı adı zorunlu/);
  assert.equal(t.validateTunnelSettings({ ...base, localPort: '' }).localPort, 0);
  assert.equal(t.validateTunnelSettings({ ...base, user: 'DOMAIN\\ali' }).user, 'DOMAIN\\ali');
});

test('ssh yolu bulma: Windows yerleşik OpenSSH, sonra PATH', () => {
  const builtIn = 'C:\\Windows\\System32\\OpenSSH\\ssh.exe';
  assert.equal(t.findSshBinary({ platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, exists: (p) => p === builtIn }), builtIn);
  assert.equal(t.findSshBinary({ platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, exists: () => false }), 'ssh');
  assert.equal(t.findSshBinary({ platform: 'linux', exists: () => false }), 'ssh');
  assert.throws(() => t.findSshBinary({ sshPath: 'D:\\yok\\ssh.exe', exists: () => false }), /bulunamadı/);
});

test('ssh hata mesajları Türkçeleştirilir', () => {
  assert.match(t.describeSshError('ali@h: Permission denied (publickey).', 255), /Kimlik doğrulama/);
  assert.match(t.describeSshError('Host key verification failed.', 255), /Sunucu anahtarı/);
  assert.match(t.describeSshError('ssh: Could not resolve hostname x: No such host is known.', 255), /çözümlenemedi/);
  assert.match(t.describeSshError('connect to host x port 22: Connection timed out', 255), /SSH bağlantılarına izin vermiyor/);
  assert.match(t.describeSshError('bind [127.0.0.1]:1080: Address already in use', 255), /portu kullanımda/);
  assert.match(t.describeSshError('', 1), /çıkış kodu 1/);
});

test('SOCKS5 yoklaması: çalışan sunucu evet, kapalı port hayır', async () => {
  const socks = await startSocks5Proxy(0);
  try {
    assert.equal(await t.probeSocks5(socks.port), true);
  } finally {
    await socks.close();
  }
  assert.equal(await t.probeSocks5(await findClosedPort(), 300), false);
});

const knownHosts = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mb-kh-')), 'ssh', 'known_hosts');
const posixOnly = { skip: process.platform === 'win32' };

test('SshTunnel: bağlanır, durumları bildirir, kapatılır', posixOnly, async () => {
  const fake = makeFakeSsh();
  const tun = new t.SshTunnel({ knownHostsFile: knownHosts() });
  const states = [];
  tun.on('state', (s) => states.push(s.state));
  const port = await t.findFreePort();
  const st = await tun.start({ ...base, sshPath: fake.sshPath, localPort: port });
  assert.equal(st.state, 'connected');
  assert.equal(st.localPort, port);
  assert.equal(await t.probeSocks5(port), true);
  const logged = fake.readArgs();
  assert.equal(logged.forward, `127.0.0.1:${port}`);
  assert.equal(logged.user, 'ali');
  assert.ok(fs.existsSync(path.dirname(tun.knownHostsFile)), 'known_hosts klasörü oluşturulur');
  await assert.rejects(tun.start({ ...base, sshPath: fake.sshPath }), /zaten açık/);
  await tun.stop();
  assert.equal(tun.state, 'idle');
  assert.deepEqual(states, ['connecting', 'connected', 'idle']);
  assert.equal(await t.probeSocks5(port, 300), false, 'süreç kapanınca port kapanır');
});

test('SshTunnel: kimlik doğrulama hatası anlaşılır mesajla raporlanır', posixOnly, async () => {
  const fake = makeFakeSsh();
  const tun = new t.SshTunnel({ knownHostsFile: knownHosts() });
  await assert.rejects(tun.start({ ...base, host: 'fail-auth.test', sshPath: fake.sshPath }), /Kimlik doğrulama başarısız/);
  assert.equal(tun.state, 'error');
});

test('SshTunnel: süreç beklenmedik şekilde ölürse "error" durumuna geçer', posixOnly, async () => {
  const fake = makeFakeSsh();
  const tun = new t.SshTunnel({ knownHostsFile: knownHosts() });
  await tun.start({ ...base, sshPath: fake.sshPath });
  const errored = new Promise((r) => tun.on('state', (s) => s.state === 'error' && r(s)));
  tun.child.kill('SIGKILL');
  const s = await errored;
  assert.match(s.message, /SSH tüneli/);
});

test('SshTunnel: ssh bulunamazsa yol gösteren mesaj', async () => {
  const tun = new t.SshTunnel({ knownHostsFile: knownHosts() });
  const missing = path.join(os.tmpdir(), 'yok', 'ssh.exe');
  await assert.rejects(tun.start({ ...base, sshPath: missing }), /ssh bulunamadı/);
});

test('SshTunnel: var olmayan anahtar dosyası baştan reddedilir', async () => {
  const tun = new t.SshTunnel({ knownHostsFile: knownHosts() });
  await assert.rejects(tun.start({ ...base, identityFile: path.join(os.tmpdir(), 'yok-anahtar') }), /anahtar dosyası bulunamadı/);
  assert.equal(tun.state, 'idle');
});
