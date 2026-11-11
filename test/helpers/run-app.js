'use strict';
/** Electron uygulamasını --smoke-test modunda çalıştırıp JSON sonucunu döndürür. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const electronBin = require('electron'); // node altında çalıştırılabilir dosya yolunu döndürür

function makeDataDir(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minibrowser-e2e-'));
  if (config !== undefined) {
    fs.writeFileSync(path.join(dir, 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  }
  return dir;
}

function runApp({ dataDir, url, extraArgs = [], timeoutMs = 45000 }) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'minibrowser-out-')), 'result.json');
  const args = [ROOT, `--data-dir=${dataDir}`, `--smoke-test=${out}`];
  if (url) args.push(`--smoke-url=${url}`);
  args.push(...extraArgs);
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electronBin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Uygulama zaman aşımına uğradı.\n${stderr}`));
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (!fs.existsSync(out)) return reject(new Error(`Sonuç dosyası yazılmadı (çıkış kodu ${code}).\n${stderr}`));
      resolve({ exitCode: code, result: JSON.parse(fs.readFileSync(out, 'utf8')), stderr });
    });
  });
}

module.exports = { ROOT, makeDataDir, runApp };
