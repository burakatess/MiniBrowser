'use strict';
/**
 * SSH tüneli ("VPN" modu): Sistemdeki OpenSSH istemcisiyle (Windows 10/11'de
 * yerleşik C:\Windows\System32\OpenSSH\ssh.exe) kullanıcının KENDİ sunucusuna
 * dinamik port yönlendirmesi (ssh -D) açar; tarayıcı trafiği yerel SOCKS5
 * portu üzerinden tünele verilir.
 *
 * Tasarım kararları:
 *  - Yönetici yetkisi, sürücü veya ek program kurulumu gerekmez.
 *  - Yalnızca anahtar / ssh-agent ile kimlik doğrulama (BatchMode=yes); parola
 *    sorulmaz ve saklanmaz.
 *  - Sunucu anahtarı uygulamaya özel known_hosts dosyasında doğrulanır;
 *    değişirse bağlantı reddedilir.
 *  - Ağ engellemelerini aşmaya yönelik hiçbir hile (ProxyCommand, port atlama,
 *    gizleme) yoktur. SSH ağda engelliyse tünel kurulamaz.
 *  - Komut kabuk olmadan, argüman dizisiyle çalıştırılır (enjeksiyon yok).
 */

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { isValidHostname, parsePort } = require('./proxy');

const USER_RE = /^[A-Za-z0-9._][A-Za-z0-9._@\\-]{0,63}$/;

class TunnelValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'TunnelValidationError';
    this.field = field;
  }
}

const DEFAULT_TUNNEL = Object.freeze({
  host: '',
  port: 22,
  user: '',
  identityFile: '',
  localPort: 0, // 0 = boş bir port otomatik seçilir
  autoConnect: false,
  sshPath: '', // boş = otomatik bul
});

/** Ayarları doğrular; `requireComplete` true ise bağlanmak için gerekenleri de zorunlu tutar. */
function validateTunnelSettings(input, { requireComplete = false } = {}) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TunnelValidationError('tunnel', 'Tünel ayarı bir nesne olmalıdır.');
  }
  const t = { ...DEFAULT_TUNNEL, ...input };
  const out = {};

  out.host = typeof t.host === 'string' ? t.host.trim() : '';
  if (out.host && (out.host.startsWith('-') || !isValidHostname(out.host))) {
    throw new TunnelValidationError('host', `Geçersiz SSH sunucusu: "${out.host}"`);
  }
  out.port = parsePort(t.port);
  if (out.port === null) throw new TunnelValidationError('port', 'SSH portu 1 ile 65535 arasında olmalıdır.');

  out.user = typeof t.user === 'string' ? t.user.trim() : '';
  if (out.user && !USER_RE.test(out.user)) {
    throw new TunnelValidationError('user', `Geçersiz kullanıcı adı: "${out.user}"`);
  }

  out.identityFile = typeof t.identityFile === 'string' ? t.identityFile.trim() : '';
  if (out.identityFile && (out.identityFile.startsWith('-') || /[\r\n\0]/.test(out.identityFile))) {
    throw new TunnelValidationError('identityFile', 'Geçersiz anahtar dosyası yolu.');
  }

  const lp = t.localPort === '' || t.localPort == null ? 0 : t.localPort;
  out.localPort = lp === 0 || lp === '0' ? 0 : parsePort(lp);
  if (out.localPort === null || (out.localPort !== 0 && out.localPort < 1024)) {
    throw new TunnelValidationError('localPort', 'Yerel port 0 (otomatik) veya 1024–65535 olmalıdır.');
  }

  out.autoConnect = t.autoConnect === true;

  out.sshPath = typeof t.sshPath === 'string' ? t.sshPath.trim() : '';
  if (out.sshPath && (out.sshPath.startsWith('-') || /[\r\n\0]/.test(out.sshPath))) {
    throw new TunnelValidationError('sshPath', 'Geçersiz ssh yolu.');
  }

  if (requireComplete) {
    if (!out.host) throw new TunnelValidationError('host', 'SSH sunucusu zorunludur.');
    if (!out.user) throw new TunnelValidationError('user', 'SSH kullanıcı adı zorunludur.');
  }
  return out;
}

/** ssh istemcisinin yolunu bulur. */
function findSshBinary({ sshPath = '', platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  if (sshPath) {
    if (!exists(sshPath)) throw new TunnelValidationError('sshPath', `ssh bulunamadı: ${sshPath}`);
    return sshPath;
  }
  if (platform === 'win32') {
    const root = env.SystemRoot || env.windir || 'C:\\Windows';
    const builtIn = path.win32.join(root, 'System32', 'OpenSSH', 'ssh.exe');
    if (exists(builtIn)) return builtIn;
  }
  return 'ssh'; // PATH üzerinden
}

/** ssh komut satırı argümanlarını üretir (kabuk kullanılmaz). */
function buildSshArgs(settings, { localPort, knownHostsFile }) {
  const s = validateTunnelSettings(settings, { requireComplete: true });
  const args = [
    '-N', // uzak komut çalıştırma
    '-T',
    '-D', `127.0.0.1:${localPort}`, // yalnızca bu bilgisayardan erişilebilir
    '-p', String(s.port),
    '-o', 'BatchMode=yes', // parola sorma
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ConnectTimeout=15',
    '-o', 'StrictHostKeyChecking=accept-new', // ilk bağlantıda kaydet, değişirse reddet
    '-o', `UserKnownHostsFile=${knownHostsFile}`,
  ];
  if (s.identityFile) args.push('-o', 'IdentitiesOnly=yes', '-i', s.identityFile);
  args.push('-l', s.user, '--', s.host);
  return args;
}

/** ssh hata çıktısını kullanıcı dostu mesaja çevirir. */
function describeSshError(stderr, exitCode) {
  const s = String(stderr || '');
  const rules = [
    [/Permission denied/i, 'Kimlik doğrulama başarısız. Kullanıcı adını ve SSH anahtarını kontrol edin (parola ile giriş desteklenmez).'],
    [/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i, 'Sunucu anahtarı kayıtlı anahtarla eşleşmiyor. Güvenliğiniz için bağlantı reddedildi.'],
    [/Could not resolve hostname/i, 'SSH sunucusunun adı çözümlenemedi.'],
    [/Connection refused/i, 'SSH sunucusu bağlantıyı reddetti (port kapalı olabilir).'],
    [/timed out|Connection timed out/i, 'SSH sunucusuna bağlanırken zaman aşımı. Ağınız SSH bağlantılarına izin vermiyor olabilir.'],
    [/Network is unreachable|No route to host/i, 'SSH sunucusuna ağ erişimi yok.'],
    [/Address already in use|cannot listen to port|forwarding failed/i, 'Yerel tünel portu kullanımda. Ayarlarda farklı bir port seçin veya 0 (otomatik) bırakın.'],
    [/no such identity|Load key .*: No such file/i, 'SSH anahtar dosyası bulunamadı.'],
    [/bad permissions|UNPROTECTED PRIVATE KEY/i, 'SSH anahtar dosyasının izinleri çok açık; dosyayı yalnızca sizin okuyabileceğiniz şekilde ayarlayın.'],
  ];
  for (const [re, msg] of rules) if (re.test(s)) return msg;
  const last = s.trim().split(/\r?\n/).filter(Boolean).pop();
  return last ? `SSH tüneli kapandı: ${last}` : `SSH tüneli beklenmedik şekilde kapandı (çıkış kodu ${exitCode}).`;
}

/** Boş bir yerel TCP portu bulur. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Yerel portta bir SOCKS5 sunucusunun yanıt verdiğini doğrular. */
function probeSocks5(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('error', () => done(false));
    sock.once('connect', () => sock.write(Buffer.from([5, 1, 0])));
    sock.once('data', (d) => done(d.length >= 2 && d[0] === 5 && d[1] === 0));
  });
}

/**
 * Durumlar: idle -> connecting -> connected -> (idle | error)
 * Olaylar: 'state' ({state, message, localPort, host})
 */
class SshTunnel extends EventEmitter {
  constructor({ knownHostsFile, log = () => {}, spawnFn = spawn, readyTimeoutMs = 20000 }) {
    super();
    this.knownHostsFile = knownHostsFile;
    this.log = log;
    this.spawnFn = spawnFn;
    this.readyTimeoutMs = readyTimeoutMs;
    this.child = null;
    this.state = 'idle';
    this.message = '';
    this.localPort = null;
    this.host = '';
    this.stopping = false;
  }

  status() {
    return { state: this.state, message: this.message, localPort: this.localPort, host: this.host };
  }

  setState(state, message = '') {
    this.state = state;
    this.message = message;
    this.emit('state', this.status());
  }

  async start(settings) {
    if (this.state === 'connecting' || this.state === 'connected') throw new Error('Tünel zaten açık.');
    const s = validateTunnelSettings(settings, { requireComplete: true });
    if (s.identityFile && !fs.existsSync(s.identityFile)) {
      throw new TunnelValidationError('identityFile', `SSH anahtar dosyası bulunamadı: ${s.identityFile}`);
    }
    const bin = findSshBinary({ sshPath: s.sshPath });
    const localPort = s.localPort || (await findFreePort());
    fs.mkdirSync(path.dirname(this.knownHostsFile), { recursive: true });
    const args = buildSshArgs(s, { localPort, knownHostsFile: this.knownHostsFile });

    this.host = `${s.user}@${s.host}:${s.port}`;
    this.localPort = localPort;
    this.stopping = false;
    this.setState('connecting', `${this.host} bağlanıyor…`);
    this.log('SSH tüneli başlatılıyor:', bin, args.join(' '));

    let stderr = '';
    let child;
    try {
      child = this.spawnFn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, shell: false });
    } catch (err) {
      this.setState('error', `ssh çalıştırılamadı: ${err.message}`);
      throw err;
    }
    this.child = child;
    child.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-4000);
    });

    const exited = new Promise((resolve) => {
      child.once('error', (err) => {
        stderr += `\n${err.code === 'ENOENT' ? 'ssh bulunamadı' : err.message}`;
        resolve(-1);
      });
      child.once('exit', (code) => resolve(code));
    });

    // Hazır olana dek (SOCKS5 yanıt verene dek) bekle.
    const deadline = Date.now() + this.readyTimeoutMs;
    let ready = false;
    let exitCode;
    exited.then((c) => (exitCode = c));
    while (Date.now() < deadline && exitCode === undefined) {
      if (await probeSocks5(localPort, 500)) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!ready) {
      if (exitCode === undefined) child.kill();
      const code = await exited;
      this.child = null;
      const msg = /ssh bulunamadı/.test(stderr)
        ? 'ssh istemcisi bulunamadı. Windows "İsteğe bağlı özellikler"den OpenSSH İstemcisi\'ni etkinleştirin veya ayarlarda ssh yolunu belirtin.'
        : exitCode === undefined
          ? 'SSH tüneli zamanında hazır olmadı.'
          : describeSshError(stderr, code);
      this.setState('error', msg);
      throw new Error(msg);
    }

    this.setState('connected', `${this.host} üzerinden bağlı`);
    exited.then((code) => {
      this.child = null;
      if (this.stopping) return this.setState('idle', 'Bağlantı kesildi.');
      this.log('SSH tüneli beklenmedik şekilde kapandı:', code, stderr.trim());
      this.setState('error', describeSshError(stderr, code));
    });
    return this.status();
  }

  async stop() {
    if (!this.child) {
      if (this.state !== 'idle') this.setState('idle', 'Bağlantı kesildi.');
      return;
    }
    this.stopping = true;
    const child = this.child;
    await new Promise((resolve) => {
      child.once('exit', resolve);
      child.kill();
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* zaten kapandı */
        }
        resolve();
      }, 3000).unref();
    });
  }

  /** Uygulama kapanırken senkron temizlik. */
  killNow() {
    if (this.child) {
      this.stopping = true;
      try {
        this.child.kill();
      } catch {
        /* yok say */
      }
    }
  }
}

module.exports = {
  DEFAULT_TUNNEL,
  TunnelValidationError,
  validateTunnelSettings,
  findSshBinary,
  buildSshArgs,
  describeSshError,
  findFreePort,
  probeSocks5,
  SshTunnel,
};
