'use strict';
/** fake-ssh.js için çalıştırılabilir bir sarmalayıcı (POSIX shell betiği) oluşturur. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function makeFakeSsh({ targetPort = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-fakessh-'));
  const logFile = path.join(dir, 'args.json');
  const script = path.join(dir, 'ssh');
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  fs.writeFileSync(
    script,
    `#!/bin/sh\nFAKE_SSH_TARGET=${Number(targetPort)} FAKE_SSH_LOG=${q(logFile)} exec ${q(process.execPath)} ${q(path.join(__dirname, 'fake-ssh.js'))} "$@"\n`
  );
  fs.chmodSync(script, 0o755);
  return { sshPath: script, logFile, readArgs: () => JSON.parse(fs.readFileSync(logFile, 'utf8')) };
}

module.exports = { makeFakeSsh };
