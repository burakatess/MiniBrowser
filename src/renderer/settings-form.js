'use strict';
/**
 * Ayar formu <-> yapılandırma dönüşümü ve hızlı istemci tarafı kontroller.
 * Kesin doğrulama ana süreçte (src/main/proxy.js) yapılır.
 * Hem tarayıcıda (window.SettingsForm) hem Node testlerinde (module.exports) çalışır.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SettingsForm = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_PORTS = { http: 8080, https: 443, socks5: 1080 };

  const TYPE_HINTS = {
    http: 'HTTP proxy: Tarayıcı proxy\'ye düz HTTP ile bağlanır; HTTPS siteler CONNECT tüneliyle uçtan uca şifreli kalır.',
    https: 'HTTPS proxy: Tarayıcı ile proxy arasındaki bağlantı da TLS ile şifrelenir. Proxy sertifikası geçerli olmalıdır.',
    socks5: 'SOCKS5 proxy: Tüm trafik ve DNS sorguları proxy üzerinden yapılır. SOCKS5 kimlik doğrulaması Chromium tarafından desteklenmez.',
  };

  function splitBypass(text) {
    return String(text || '')
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const toPort = (v) => {
    const text = String(v ?? '').trim();
    return /^\d+$/.test(text) ? Number(text) : text;
  };
  const str = (v) => String(v ?? '').trim();

  function formToConfig(values) {
    const t = values.tunnel || {};
    return {
      homepage: str(values.homepage),
      proxy: {
        mode: values.mode,
        type: values.type,
        host: str(values.host),
        port: toPort(values.port),
        bypass: splitBypass(values.bypass),
      },
      tunnel: {
        host: str(t.host),
        port: toPort(t.port || 22),
        user: str(t.user),
        identityFile: str(t.identityFile),
        localPort: str(t.localPort) === '' ? 0 : toPort(t.localPort),
        autoConnect: t.autoConnect === true,
        sshPath: str(t.sshPath),
      },
    };
  }

  function configToForm(config) {
    const t = config.tunnel || {};
    return {
      mode: config.proxy.mode,
      type: config.proxy.type,
      host: config.proxy.host || '',
      port: String(config.proxy.port ?? ''),
      bypass: (config.proxy.bypass || []).join(', '),
      homepage: config.homepage,
      tunnel: {
        host: t.host || '',
        port: String(t.port ?? 22),
        user: t.user || '',
        identityFile: t.identityFile || '',
        localPort: String(t.localPort ?? 0),
        autoConnect: t.autoConnect === true,
        sshPath: t.sshPath || '',
      },
    };
  }

  /** Tünel alanları; `forConnect` true ise bağlanmak için gerekenler zorunlu. Anahtarlar "t-<alan>". */
  function quickValidateTunnel(t, { forConnect = false } = {}) {
    const errors = {};
    if (!t) return errors;
    if (t.host && (/\s/.test(t.host) || t.host.startsWith('-') || /:\/\//.test(t.host))) errors['t-host'] = 'Geçersiz sunucu adresi.';
    if (!Number.isInteger(t.port) || t.port < 1 || t.port > 65535) errors['t-port'] = 'Port 1–65535 arasında olmalıdır.';
    if (t.user && !/^[A-Za-z0-9._][A-Za-z0-9._@\\-]*$/.test(t.user)) errors['t-user'] = 'Kullanıcı adında geçersiz karakter var.';
    if (!(t.localPort === 0 || (Number.isInteger(t.localPort) && t.localPort >= 1024 && t.localPort <= 65535))) {
      errors['t-localPort'] = 'Yerel port 0 (otomatik) veya 1024–65535 olmalıdır.';
    }
    if (forConnect) {
      if (!t.host) errors['t-host'] = 'VPN için SSH sunucusu zorunludur.';
      if (!t.user) errors['t-user'] = 'VPN için kullanıcı adı zorunludur.';
    }
    return errors;
  }

  /** Alan -> hata mesajı. Boş nesne = sorun yok. */
  function quickValidate(cfg) {
    const errors = {};
    const p = cfg.proxy;
    if (p.mode === 'manual') {
      if (!p.host) errors.host = 'Sunucu adresi zorunludur.';
      else if (/\s/.test(p.host)) errors.host = 'Sunucu adresi boşluk içeremez.';
      else if (/:\/\//.test(p.host)) errors.host = 'Şema yazmayın (ör. http://); türü listeden seçin.';
      if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) errors.port = 'Port 1–65535 arasında olmalıdır.';
    }
    const bad = p.bypass.find((b) => /\s/.test(b));
    if (bad) errors.bypass = `Geçersiz girdi: "${bad}"`;
    if (!/^https?:\/\/\S+$/i.test(cfg.homepage)) errors.homepage = 'Ana sayfa http:// veya https:// ile başlamalıdır.';
    return Object.assign(errors, quickValidateTunnel(cfg.tunnel));
  }

  return { DEFAULT_PORTS, TYPE_HINTS, splitBypass, formToConfig, configToForm, quickValidate, quickValidateTunnel };
});
