'use strict';
/**
 * Portable veri dizinlerinin belirlenmesi. Tüm veriler (config + profil)
 * uygulamanın yanında tutulur; %APPDATA% veya kayıt defteri kullanılmaz.
 */

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR_NAME = 'MiniBrowserData';

/**
 * argv içinden --data-dir=<yol> veya --data-dir <yol> değerini okur.
 * Birden fazla verilirse SONUNCUSU geçerlidir (BAT'a verilen argüman,
 * BAT'ın varsayılanını ezer).
 */
function parseDataDirArg(argv) {
  let found = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--data-dir=')) found = a.slice('--data-dir='.length).replace(/^"|"$/g, '');
    else if (a === '--data-dir' && i + 1 < argv.length) found = argv[++i];
  }
  return found && found.trim() ? found.trim() : null;
}

/**
 * Veri dizinini çözer. Öncelik:
 *  1. --data-dir argümanı
 *  2. PORTABLE_EXECUTABLE_DIR (electron-builder portable .exe'nin bulunduğu klasör)
 *  3. Paketlenmişse .exe'nin klasörü, değilse proje kökü
 */
function resolveDataDir({ argv = [], env = {}, execPath, isPackaged, appRoot, cwd = process.cwd() }) {
  const arg = parseDataDirArg(argv);
  if (arg) return path.resolve(cwd, arg);
  if (env.PORTABLE_EXECUTABLE_DIR) return path.join(env.PORTABLE_EXECUTABLE_DIR, DATA_DIR_NAME);
  const base = isPackaged ? path.dirname(execPath) : appRoot;
  return path.join(base, DATA_DIR_NAME);
}

function buildPaths(dataDir) {
  return {
    dataDir,
    configFile: path.join(dataDir, 'config.json'),
    profileDir: path.join(dataDir, 'profile'),
    logsDir: path.join(dataDir, 'logs'),
    crashDir: path.join(dataDir, 'crashes'),
  };
}

/**
 * Dizinleri oluşturur ve yazılabilir olduğunu doğrular.
 * Yazılamıyorsa anlaşılır bir hata fırlatır (ör. salt-okunur USB, Program Files).
 */
function ensureWritableDirs(paths) {
  for (const dir of [paths.dataDir, paths.profileDir, paths.logsDir, paths.crashDir]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      throw new Error(`Klasör oluşturulamadı: ${dir} (${err.code || err.message})`);
    }
  }
  const probe = path.join(paths.dataDir, `.write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch (err) {
    throw new Error(
      `Veri klasörüne yazılamıyor: ${paths.dataDir} (${err.code || err.message}). ` +
        'MiniBrowser\'ı yazma izniniz olan bir klasöre (ör. Belgeler veya USB bellek) taşıyın ' +
        'ya da --data-dir ile başka bir klasör belirtin.'
    );
  }
}

module.exports = { DATA_DIR_NAME, parseDataDirArg, resolveDataDir, buildPaths, ensureWritableDirs };
