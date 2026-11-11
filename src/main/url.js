'use strict';
/** Adres çubuğu girdisini güvenli bir URL'ye çevirir. */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function isAllowedUrl(value) {
  if (value === 'about:blank') return true;
  try {
    return ALLOWED_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * - "example.com"        -> "https://example.com/"
 * - "http://x:8080/a"    -> aynen
 * - "localhost:3000"     -> "http://localhost:3000/"
 * - "nasıl yapılır"      -> arama URL'si
 * - "javascript:..."/"file:..." -> null (engellenir)
 */
function normalizeInput(input, searchUrl) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  if (text === 'about:blank') return text;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    return isAllowedUrl(text) ? new URL(text).toString() : null;
  }
  // "javascript:", "file:", "data:" gibi şemalar engellenir ("host:port" hariç).
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/\s/.test(text) && !/^[^\s/:]+:\d+(\/|$)/.test(text)) {
    return null;
  }

  const looksLikeHost =
    !/\s/.test(text) &&
    (/^localhost(:\d+)?(\/|$)/i.test(text) ||
      /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(text) ||
      /^\[[0-9a-f:]+\](:\d+)?(\/|$)/i.test(text) ||
      /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/|$|\?|#)/i.test(text));

  if (looksLikeHost) {
    const local = /^(localhost|127\.|\[::1\])/i.test(text);
    try {
      return new URL(`${local ? 'http' : 'https'}://${text}`).toString();
    } catch {
      /* aramaya düş */
    }
  }
  return searchUrl.replace('%s', encodeURIComponent(text));
}

module.exports = { isAllowedUrl, normalizeInput };
