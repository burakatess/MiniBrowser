'use strict';
/**
 * Yapılandırma dosyası (config.json) okuma / doğrulama / atomik yazma.
 * Electron'a bağımlı değildir.
 */

const fs = require('node:fs');
const path = require('node:path');
const { validateProxySettings, ProxyValidationError } = require('./proxy');

const CONFIG_VERSION = 1;

const DEFAULT_CONFIG = Object.freeze({
  version: CONFIG_VERSION,
  homepage: 'https://example.com/',
  searchUrl: 'https://duckduckgo.com/?q=%s',
  proxy: Object.freeze({ mode: 'system', type: 'http', host: '', port: 8080, bypass: ['<local>'] }),
  window: Object.freeze({ width: 1200, height: 800 }),
});

class ConfigError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'ConfigError';
    this.field = field;
  }
}

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function validateHttpUrl(value, field) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new ConfigError(field, `${field} geçerli bir URL değil: "${value}"`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new ConfigError(field, `${field} yalnızca http/https olabilir.`);
  }
  return u.toString();
}

function clampInt(value, min, max, fallback) {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/**
 * Kısmi/ham bir yapılandırmayı varsayılanlarla birleştirip doğrular.
 * Hata durumunda ConfigError fırlatır (proxy hataları da ConfigError'a sarılır).
 */
function validateConfig(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError('root', 'Yapılandırma bir JSON nesnesi olmalıdır.');
  }
  const d = cloneDefaults();
  if (raw.version != null && raw.version !== CONFIG_VERSION) {
    throw new ConfigError('version', `Desteklenmeyen yapılandırma sürümü: ${raw.version}`);
  }
  const homepage = validateHttpUrl(raw.homepage ?? d.homepage, 'homepage');

  const searchUrl = raw.searchUrl ?? d.searchUrl;
  if (typeof searchUrl !== 'string' || !searchUrl.includes('%s')) {
    throw new ConfigError('searchUrl', 'searchUrl "%s" yer tutucusunu içermelidir.');
  }
  validateHttpUrl(searchUrl.replace('%s', 'test'), 'searchUrl');

  let proxy;
  try {
    proxy = validateProxySettings({ ...d.proxy, ...(raw.proxy || {}) });
  } catch (err) {
    if (err instanceof ProxyValidationError) throw new ConfigError(`proxy.${err.field}`, err.message);
    throw err;
  }

  const w = raw.window || {};
  const window = {
    width: clampInt(w.width, 400, 10000, d.window.width),
    height: clampInt(w.height, 300, 10000, d.window.height),
  };
  return { version: CONFIG_VERSION, homepage, searchUrl, proxy, window };
}

/**
 * Yapılandırmayı yükler. Dosya yoksa varsayılanlarla oluşturur.
 * Bozuksa (JSON hatası veya doğrulama hatası) dosyanın yedeğini alır,
 * varsayılanlara döner ve `warning` alanında nedenini bildirir.
 * @returns {{config: object, warning: string|null, created: boolean}}
 */
function loadConfig(filePath, { now = () => Date.now() } = {}) {
  if (!fs.existsSync(filePath)) {
    const config = cloneDefaults();
    saveConfig(filePath, config);
    return { config, warning: null, created: true };
  }
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new ConfigError('file', `Yapılandırma dosyası okunamadı: ${err.message}`);
  }
  try {
    const parsed = JSON.parse(text.replace(/^﻿/, '')); // Not Defteri BOM'u
    return { config: validateConfig(parsed), warning: null, created: false };
  } catch (err) {
    const backup = `${filePath}.corrupt-${now()}`;
    try {
      fs.copyFileSync(filePath, backup);
    } catch {
      /* yedek alınamazsa da devam edilir */
    }
    const config = cloneDefaults();
    saveConfig(filePath, config);
    const reason = err instanceof SyntaxError ? `JSON sözdizimi hatası (${err.message})` : err.message;
    return {
      config,
      warning: `Yapılandırma dosyası geçersizdi ve varsayılanlara sıfırlandı: ${reason}. Yedek: ${path.basename(backup)}`,
      created: false,
    };
  }
}

/** Doğrular ve atomik olarak yazar (geçici dosya + rename). */
function saveConfig(filePath, config) {
  const valid = validateConfig(config);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(valid, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath);
  return valid;
}

module.exports = { CONFIG_VERSION, DEFAULT_CONFIG, ConfigError, validateConfig, loadConfig, saveConfig };
