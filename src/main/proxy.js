'use strict';
/**
 * Proxy ayarlarının doğrulanması ve Electron `session.setProxy()` biçimine
 * dönüştürülmesi. Bu modül Electron'a bağımlı değildir; birim testleriyle
 * doğrudan Node.js altında test edilir.
 */

const net = require('node:net');

const PROXY_MODES = Object.freeze(['direct', 'system', 'manual']);
const PROXY_TYPES = Object.freeze(['http', 'https', 'socks5']);

// RFC 1123 host adı etiketi
const HOST_LABEL = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/;
// Bypass girdileri: joker (*), nokta, port, CIDR ve <local> kabul edilir.
// ';' ve boşluk, kurallara enjeksiyonu önlemek için yasaktır.
const BYPASS_ENTRY = /^(<local>|<-loopback>|[A-Za-z0-9.*\-_:[\]/]+)$/;

class ProxyValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'ProxyValidationError';
    this.field = field;
  }
}

function stripBrackets(host) {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function isValidHostname(host) {
  if (typeof host !== 'string') return false;
  const h = host.trim();
  if (h.length === 0 || h.length > 253) return false;
  const bare = stripBrackets(h);
  if (net.isIP(bare)) return true;
  // Tamamen sayısal ama geçersiz bir IPv4 (ör. 999.1.1.1) host adı sayılmaz.
  if (/^[0-9.]+$/.test(h)) return false;
  return h.replace(/\.$/, '').split('.').every((label) => HOST_LABEL.test(label));
}

function parsePort(value) {
  if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) value = Number(value);
  if (!Number.isInteger(value) || value < 1 || value > 65535) return null;
  return value;
}

function normalizeBypass(bypass) {
  let list;
  if (bypass == null) list = [];
  else if (Array.isArray(bypass)) list = bypass;
  else if (typeof bypass === 'string') list = bypass.split(/[,;\n]/);
  else throw new ProxyValidationError('bypass', 'Bypass listesi dizi veya metin olmalıdır.');

  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') {
      throw new ProxyValidationError('bypass', 'Bypass girdileri metin olmalıdır.');
    }
    const entry = raw.trim();
    if (!entry) continue;
    if (!BYPASS_ENTRY.test(entry)) {
      throw new ProxyValidationError('bypass', `Geçersiz bypass girdisi: "${entry}"`);
    }
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

/**
 * Ham proxy ayarını doğrular ve normalize edilmiş bir kopya döndürür.
 * Geçersizse ProxyValidationError fırlatır.
 */
function validateProxySettings(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ProxyValidationError('proxy', 'Proxy ayarı bir nesne olmalıdır.');
  }
  const mode = input.mode ?? 'system';
  if (!PROXY_MODES.includes(mode)) {
    throw new ProxyValidationError('mode', `Geçersiz proxy modu: "${mode}". (${PROXY_MODES.join(', ')})`);
  }
  const type = input.type ?? 'http';
  if (!PROXY_TYPES.includes(type)) {
    throw new ProxyValidationError('type', `Desteklenmeyen proxy türü: "${type}". (${PROXY_TYPES.join(', ')})`);
  }
  const bypass = normalizeBypass(input.bypass);
  const host = typeof input.host === 'string' ? input.host.trim() : '';
  const rawPort = input.port ?? (type === 'socks5' ? 1080 : 8080);

  if (mode !== 'manual') {
    // Manuel değilse host/port saklanır ama zorunlu değildir.
    const port = parsePort(rawPort) ?? (type === 'socks5' ? 1080 : 8080);
    return { mode, type, host, port, bypass };
  }

  if (!host) throw new ProxyValidationError('host', 'Manuel modda proxy sunucusu (host) zorunludur.');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) {
    throw new ProxyValidationError('host', 'Host alanına şema yazmayın (ör. "http://"). Türü ayrı seçin.');
  }
  if (!isValidHostname(host)) throw new ProxyValidationError('host', `Geçersiz proxy sunucusu: "${host}"`);
  const port = parsePort(rawPort);
  if (port === null) throw new ProxyValidationError('port', 'Port 1 ile 65535 arasında bir tam sayı olmalıdır.');
  return { mode, type, host, port, bypass };
}

function formatHostPort(host, port) {
  const bare = stripBrackets(host);
  return net.isIPv6(bare) ? `[${bare}]:${port}` : `${host}:${port}`;
}

/**
 * Doğrulanmış ayarı Electron'un ProxyConfig nesnesine çevirir.
 *  - http   -> "http://host:port"   (tüm şemalar için HTTP proxy)
 *  - https  -> "https://host:port"  (proxy'ye TLS ile bağlanılır)
 *  - socks5 -> "socks5://host:port" (DNS çözümlemesi proxy üzerinden)
 */
function toElectronProxyConfig(settings) {
  const s = validateProxySettings(settings);
  if (s.mode === 'direct') return { mode: 'direct' };
  if (s.mode === 'system') return { mode: 'system' };
  return {
    mode: 'fixed_servers',
    proxyRules: `${s.type}://${formatHostPort(s.host, s.port)}`,
    proxyBypassRules: s.bypass.join(';'),
  };
}

/** Arayüzde gösterilecek kısa açıklama. */
function describeProxy(settings) {
  const s = validateProxySettings(settings);
  if (s.mode === 'direct') return 'Doğrudan bağlantı (proxy yok)';
  if (s.mode === 'system') return 'Sistem proxy ayarları';
  return `${s.type.toUpperCase()} ${formatHostPort(s.host, s.port)}`;
}

module.exports = {
  PROXY_MODES,
  PROXY_TYPES,
  ProxyValidationError,
  isValidHostname,
  parsePort,
  normalizeBypass,
  validateProxySettings,
  toElectronProxyConfig,
  describeProxy,
};
