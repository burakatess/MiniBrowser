'use strict';
/**
 * Testler için sahte "ssh" istemcisi. Gerçek ssh gibi `-D 127.0.0.1:PORT`
 * argümanını okur ve o portta bir SOCKS5 sunucusu açar; tüm bağlantıları
 * FAKE_SSH_TARGET portuna yönlendirir. Aldığı argümanları FAKE_SSH_LOG
 * dosyasına yazar. Özel host adları hata senaryolarını canlandırır:
 *   fail-auth.test   -> "Permission denied (publickey)." ile çıkış 255
 *   hostkey.test     -> "Host key verification failed." ile çıkış 255
 *   refused.test     -> "Connection refused" ile çıkış 255
 */
const fs = require('node:fs');
const { startSocks5Proxy } = require('./servers');

const args = process.argv.slice(2);
const at = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};
const host = args[args.indexOf('--') + 1];
const user = at('-l');
const forward = at('-D');
if (process.env.FAKE_SSH_LOG) fs.writeFileSync(process.env.FAKE_SSH_LOG, JSON.stringify({ args, host, user, forward }));

const fail = (msg) => {
  process.stderr.write(`${msg}\r\n`);
  process.exit(255);
};
if (host === 'fail-auth.test') fail(`${user}@${host}: Permission denied (publickey).`);
if (host === 'hostkey.test') fail('Host key verification failed.');
if (host === 'refused.test') fail(`ssh: connect to host ${host} port 22: Connection refused`);
if (!forward || !/^127\.0\.0\.1:\d+$/.test(forward)) fail('fake-ssh: -D 127.0.0.1:PORT bekleniyordu');

const listenPort = Number(forward.split(':')[1]);
startSocks5Proxy(Number(process.env.FAKE_SSH_TARGET || 0), { listenPort }).catch((err) => {
  fail(`bind [127.0.0.1]:${listenPort}: Address already in use (${err.code})`);
});
process.on('SIGTERM', () => process.exit(0));
