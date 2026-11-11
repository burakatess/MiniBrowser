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

  function formToConfig(values) {
    const portText = String(values.port ?? '').trim();
    return {
      homepage: String(values.homepage || '').trim(),
      proxy: {
        mode: values.mode,
        type: values.type,
        host: String(values.host || '').trim(),
        port: /^\d+$/.test(portText) ? Number(portText) : portText,
        bypass: splitBypass(values.bypass),
      },
    };
  }

  function configToForm(config) {
    return {
      mode: config.proxy.mode,
      type: config.proxy.type,
      host: config.proxy.host || '',
      port: String(config.proxy.port ?? ''),
      bypass: (config.proxy.bypass || []).join(', '),
      homepage: config.homepage,
    };
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
    return errors;
  }

  return { DEFAULT_PORTS, TYPE_HINTS, splitBypass, formToConfig, configToForm, quickValidate };
});
