'use strict';
/** Chromium ağ hata kodlarını kullanıcı dostu Türkçe mesajlara çevirir. */

const PROXY_HINT = 'Proxy ayarlarınızı (⚙ Ayarlar) kontrol edin veya ağ yöneticinize danışın.';

const MESSAGES = {
  '-130': ['Proxy sunucusuna bağlanılamadı', PROXY_HINT], // ERR_PROXY_CONNECTION_FAILED
  '-111': ['Proxy tüneli kurulamadı', PROXY_HINT], // ERR_TUNNEL_CONNECTION_FAILED
  '-120': ['SOCKS proxy bağlantısı başarısız', PROXY_HINT], // ERR_SOCKS_CONNECTION_FAILED
  '-121': ['SOCKS proxy hedef adresi çözümleyemedi', PROXY_HINT], // ERR_SOCKS_CONNECTION_HOST_UNREACHABLE
  '-127': ['Proxy kimlik doğrulaması gerekli', 'Kullanıcı adı ve parolanızı kontrol edin.'], // ERR_PROXY_AUTH_UNSUPPORTED / requested
  '-115': ['Proxy kimlik doğrulaması gerekli', 'Kullanıcı adı ve parolanızı kontrol edin.'], // ERR_PROXY_AUTH_REQUESTED
  '-336': ['Proxy sertifikası hatası', 'HTTPS proxy sertifikası doğrulanamadı.'], // ERR_PROXY_CERTIFICATE_INVALID
  '-105': ['Sunucu adresi bulunamadı', 'Adresi kontrol edin veya DNS/proxy ayarlarınızı gözden geçirin.'], // ERR_NAME_NOT_RESOLVED
  '-106': ['İnternet bağlantısı yok', 'Ağ bağlantınızı kontrol edin.'], // ERR_INTERNET_DISCONNECTED
  '-102': ['Bağlantı reddedildi', 'Sunucu bağlantıyı kabul etmedi.'], // ERR_CONNECTION_REFUSED
  '-118': ['Bağlantı zaman aşımına uğradı', 'Sunucu yanıt vermedi.'], // ERR_CONNECTION_TIMED_OUT
  '-7': ['İstek zaman aşımına uğradı', 'Sunucu yanıt vermedi.'], // ERR_TIMED_OUT
  '-20': ['Erişim engellendi', 'Bu sayfaya erişim kuruluşunuz veya ağ tarafından engellenmiş olabilir.'], // ERR_BLOCKED_BY_CLIENT
  '-21': ['Erişim yönetici tarafından engellendi', 'Kuruluş politikası bu adrese erişime izin vermiyor.'], // ERR_BLOCKED_BY_ADMINISTRATOR
  '-200': ['Güvenli bağlantı kurulamadı', 'Sertifika geçersiz. Güvenliğiniz için sayfa açılmadı.'], // ERR_CERT_COMMON_NAME_INVALID
  '-201': ['Güvenli bağlantı kurulamadı', 'Sertifika tarihi geçersiz. Güvenliğiniz için sayfa açılmadı.'],
  '-202': ['Güvenli bağlantı kurulamadı', 'Sertifika güvenilir değil. Güvenliğiniz için sayfa açılmadı.'],
};

function isProxyError(code) {
  return [-130, -111, -120, -121, -127, -115, -336].includes(Number(code));
}

function describeNetError(code, description) {
  const hit = MESSAGES[String(code)];
  if (hit) return { title: hit[0], hint: hit[1], code: Number(code), name: description || '' };
  return {
    title: 'Sayfa yüklenemedi',
    hint: 'Adresi ve ağ bağlantınızı kontrol edin.',
    code: Number(code),
    name: description || '',
  };
}

module.exports = { describeNetError, isProxyError };
