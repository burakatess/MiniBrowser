# MiniBrowser

Windows için **kurulum ve yönetici yetkisi gerektirmeyen**, Chromium tabanlı (Electron) portable bir tarayıcı.
HTTP, HTTPS ve SOCKS5 proxy desteği, HTML/CSS/JavaScript ile yazılmış proxy ayar ekranı, JSON yapılandırma
dosyası ve uygulamaya özel ayrı bir kullanıcı profili içerir.

## Özellikler

| Özellik | Açıklama |
|---|---|
| Portable | Tüm veriler `.exe`'nin yanındaki `MiniBrowserData\` klasöründe. `%APPDATA%`, kayıt defteri veya sistem ayarlarına yazılmaz. |
| Admin gerekmez | Manifest `asInvoker`, portable paket `requestExecutionLevel user`. BAT dosyası `runas`, `reg`, `setx` vb. kullanmaz. |
| Proxy modları | **Sistem** (Windows / kurum proxy ve PAC — varsayılan), **Manuel** (HTTP / HTTPS / SOCKS5), **Doğrudan** |
| Bypass listesi | `<local>`, `*.corp.local`, `10.0.0.0/8` gibi proxy dışı adresler |
| Bağlantı testi | Ayar ekranındaki “Bağlantıyı test et”, ana profili etkilemeyen geçici bir oturumla dener |
| Proxy kimlik doğrulama | 407 isteğinde kullanıcı adı/parola sorulur; **diske kaydedilmez** |
| Ayrı profil | Çerezler, önbellek ve geçmiş `MiniBrowserData\profile\` içinde; Chrome/Edge profilinize dokunulmaz |
| Hata kontrolleri | Bozuk/geçersiz config yedeklenip sıfırlanır, yazılamayan klasör, ZIP içinden çalıştırma, eksik exe, proxy bağlantı hataları için Türkçe mesajlar |

## Kullanım (son kullanıcı)

1. `MiniBrowser-1.0.0-win.zip` dosyasını yazma izniniz olan bir klasöre (ör. `Belgeler` veya USB bellek) **çıkartın**.
2. `MiniBrowser.bat` dosyasına çift tıklayın (veya doğrudan `MiniBrowser.exe`).
3. Üst çubuktaki **⚙** düğmesi veya proxy rozeti ile proxy ayarlarını açın, **Bağlantıyı test et**, ardından **Kaydet ve uygula**.

Tek dosya isteyenler için `MiniBrowser-1.0.0-portable.exe` de üretilir; verileri exe'nin bulunduğu klasördeki
`MiniBrowserData\` altında tutar.

```bat
MiniBrowser.bat --data-dir=D:\Profiller\Is      :: başka bir veri/profil klasörü
set MINIBROWSER_DATA_DIR=D:\Profiller\Test       :: aynısı, ortam değişkeniyle
MiniBrowser.bat --help
```

Aynı veri klasörüyle ikinci kez açılırsa mevcut pencere öne gelir (Chromium profil kilidini korur).
Farklı `--data-dir` ile birden fazla bağımsız profil aynı anda kullanılabilir.

## Yapılandırma dosyası

`MiniBrowserData\config.json` (ilk çalıştırmada oluşturulur; örnek: `config/default.config.json`):

```json
{
  "version": 1,
  "homepage": "https://example.com/",
  "searchUrl": "https://duckduckgo.com/?q=%s",
  "proxy": {
    "mode": "manual",
    "type": "socks5",
    "host": "proxy.ornek.local",
    "port": 1080,
    "bypass": ["<local>", "*.ornek.local"]
  },
  "window": { "width": 1200, "height": 800 }
}
```

| Alan | Değerler |
|---|---|
| `proxy.mode` | `system` · `manual` · `direct` |
| `proxy.type` | `http` (proxy'ye düz HTTP; HTTPS siteler CONNECT tüneliyle şifreli kalır) · `https` (proxy'ye TLS ile bağlanılır) · `socks5` (DNS de proxy üzerinden) |
| `proxy.host` | Host adı, IPv4 veya IPv6. Şema (`http://`), boşluk, `;` kabul edilmez. |
| `proxy.port` | 1–65535 |
| `proxy.bypass` | Dizi; `;`/boşluk içeremez |
| `homepage` | Yalnızca `http`/`https` |
| `searchUrl` | `%s` içermeli |

Dosya elle düzenlenebilir (Not Defteri'nin eklediği BOM desteklenir). JSON bozuksa veya bir değer geçersizse
dosya `config.json.corrupt-<zaman>` olarak yedeklenir, varsayılanlar yüklenir ve üst çubukta uyarı gösterilir.
Yazma işlemi atomiktir (geçici dosya + yeniden adlandırma).

Klasör yapısı:

```
MiniBrowser\
├─ MiniBrowser.exe
├─ MiniBrowser.bat
└─ MiniBrowserData\
   ├─ config.json
   ├─ profile\        ← ayrı Chromium profili
   ├─ logs\minibrowser.log
   └─ crashes\
```

## Güvenlik ve kurumsal politikalar

MiniBrowser kurumsal güvenlik kontrollerini **atlatmak için tasarlanmamıştır**:

- Sertifika doğrulaması devre dışı bırakılmaz; geçersiz sertifikalı siteler açılmaz (`--ignore-certificate-errors`,
  `certificate-error` işleyicisi vb. yoktur — testlerle denetlenir).
- Windows proxy, güvenlik duvarı veya kayıt defteri ayarları değiştirilmez; yönetici yetkisi istenmez.
- Varsayılan mod **Sistem**dir: kurumunuzun proxy/PAC ayarları kullanılır. Kurumsal ağda yalnızca kullanma
  yetkiniz olan proxy sunucularını girin ve BT politikalarınıza uyun. Ağ düzeyinde engelleme (güvenlik duvarı,
  TLS denetimi, AppLocker/WDAC) MiniBrowser tarafından aşılmaz; kurum uygulama çalıştırmayı kısıtlıyorsa
  BT ekibinizden onay alın.
- Tüm pencereler `contextIsolation`, `sandbox` ve `nodeIntegration: false` ile çalışır; arayüz sayfalarında CSP vardır.
- Adres çubuğunda yalnızca `http`/`https` açılır (`file:`, `javascript:`, `data:` engellenir).
- Kamera, mikrofon, konum, bildirim gibi izin istekleri varsayılan olarak reddedilir.
- Proxy parolaları diske yazılmaz.

Bilinen sınırlamalar: Chromium SOCKS5 kullanıcı adı/parola doğrulamasını desteklemez. Tek sekmeli,
minimal bir tarayıcıdır; eklenti desteği yoktur. Exe imzasızdır; SmartScreen uyarısı görülebilir
(kurumsal dağıtım için kod imzalama sertifikası ekleyin).

## Geliştirme

Gereksinimler: Node.js 20+ (22 ile test edildi). Admin gerekmez.

```bash
npm install
npm start              # geliştirme modunda çalıştır (veriler ./MiniBrowserData)
npm test               # birim + statik testler (Electron gerekmez)
npm run test:e2e       # gerçek Electron ile uçtan uca testler
npm run dist:win       # dist/ altında portable .exe + .zip
```

Windows'ta geliştirme modunda `npm install` sonrası `MiniBrowser.bat` doğrudan `node_modules\electron` ile çalışır.

### Proje yapısı

```
src/main/main.js        Ana süreç: pencereler, proxy uygulama, IPC, hata sayfaları, kimlik doğrulama
src/main/proxy.js       Proxy doğrulama ve Electron proxy kuralı üretimi
src/main/config.js      config.json yükleme / doğrulama / atomik kaydetme
src/main/paths.js       Portable veri klasörü çözümleme, yazılabilirlik kontrolü
src/main/url.js         Adres çubuğu girdisi → güvenli URL
src/main/errors.js      Chromium ağ hata kodları → Türkçe mesajlar
src/preload/*.js        contextBridge ile dar IPC API'leri
src/renderer/*          Araç çubuğu, proxy ayar ekranı, hata ve kimlik doğrulama sayfaları
MiniBrowser.bat         Windows başlatıcısı
test/unit/              Birim ve statik testler
test/e2e/               Electron + yerel HTTP/SOCKS5 proxy sunucularıyla uçtan uca testler
```

### Testler

- **Birim (50 test):** proxy doğrulama (enjeksiyon, IPv6, port sınırları), config yükleme/bozuk dosya/BOM,
  veri klasörü önceliği, URL normalleştirme, ayar formu dönüşümü.
- **Statik:** BAT dosyası CRLF/ASCII, admin/sistem komutu içermez, etiket/parantez dengesi; kaynakta güvenlik
  ayarlarının gevşetilmediği, CSP ve dosya referansları.
- **Uçtan uca (12 test):** gerçek Chromium ile doğrudan, HTTP proxy ve SOCKS5 proxy üzerinden sayfa yükleme
  (DNS'te olmayan `.test` alan adı yalnızca proxy üzerinden açılabildiği için trafiğin proxy'den geçtiği kanıtlanır),
  HTTPS proxy kuralı, bypass, kapalı proxy hatası (`-130`), bozuk config, yazılamayan klasör; ayar ekranının DOM
  üzerinden doldurulup kaydedilmesi, geçersiz port/enjeksiyon reddi ve “Bağlantıyı test et”.

`--smoke-test`, `--smoke-url`, `--smoke-settings` argümanları yalnızca otomatik testler içindir.
