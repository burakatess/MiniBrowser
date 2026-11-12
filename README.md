# MiniBrowser

Windows için **kurulum ve yönetici yetkisi gerektirmeyen**, Chromium tabanlı (Electron) portable bir tarayıcı.
Çoklu sekme, HTTP/HTTPS/SOCKS5 proxy, kendi SSH sunucunuz üzerinden **VPN (SSH tüneli)**, HTML/CSS/JavaScript
ile yazılmış ayar ekranı, JSON yapılandırma dosyası ve uygulamaya özel ayrı bir kullanıcı profili içerir.

## Özellikler

| Özellik | Açıklama |
|---|---|
| Çoklu sekme | Sekme şeridi, `+` düğmesi, yeni pencere/`target=_blank` bağlantıları yeni sekmede, orta tıkla kapatma, kapatılan sekmeyi geri açma |
| VPN (SSH tüneli) | Tek tıkla aç/kapa; tüm sekmeler kendi SSH sunucunuz üzerinden şifreli geçer. Tünel koparsa sayfalar tünelsiz yüklenmez (kill switch) |
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

### Klavye kısayolları

| Kısayol | İşlev |
|---|---|
| `Ctrl+T` | Yeni sekme |
| `Ctrl+W` / `Ctrl+F4` | Sekmeyi kapat |
| `Ctrl+Shift+T` | Son kapatılan sekmeyi geri aç |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Sonraki / önceki sekme |
| `Ctrl+1` … `Ctrl+8`, `Ctrl+9` | n. sekme, son sekme |
| `Ctrl+L` | Adres çubuğu |
| `F5` / `Ctrl+R`, `Alt+←` / `Alt+→` | Yenile, geri / ileri |

Son sekme kapatılınca pencere kapanır.

### VPN (SSH tüneli)

“VPN” düğmesi tarayıcının tüm trafiğini **kendi** SSH sunucunuza açılan şifreli bir tünelden (`ssh -D`) geçirir.
Windows 10/11'in yerleşik OpenSSH istemcisi (`C:\Windows\System32\OpenSSH\ssh.exe`) kullanılır; ek program,
sürücü veya yönetici yetkisi gerekmez. OpenSSH istemcisi kapalıysa Ayarlar → Uygulamalar → İsteğe bağlı
özellikler → “OpenSSH İstemcisi” ile etkinleştirilebilir (bu adım kurumunuzun izin vermesini gerektirebilir).

1. ⚙ Ayarlar → **VPN (SSH tüneli)**: sunucu, port, kullanıcı adı ve (isteğe bağlı) özel anahtar dosyası.
2. **Kaydet ve bağlan** veya üst çubuktaki **VPN** düğmesi. Düğme durumu gösterir: kapalı / bağlanıyor / açık / hata.
3. Kapatmak için düğmeye tekrar basın; ayarlardaki normal proxy moduna dönülür.

Güvenlik davranışı:
- **Yalnızca anahtar / ssh-agent** ile giriş (`BatchMode=yes`). Parola sorulmaz ve hiçbir yere kaydedilmez.
- Sunucu anahtarı ilk bağlantıda `MiniBrowserData\ssh\known_hosts` dosyasına kaydedilir; sonradan değişirse
  bağlantı **reddedilir** (`StrictHostKeyChecking=accept-new`).
- Yerel SOCKS portu yalnızca `127.0.0.1`'e bağlanır; ağdaki başka cihazlar kullanamaz.
- **Kill switch:** VPN açıkken tünel koparsa veya hiç kurulamazsa trafik tünel portuna yönlendirilmeye devam eder;
  sayfalar sessizce tünelsiz açılmaz, hata sayfası gösterilir. Normal bağlantıya dönmek için VPN'i kapatın.
- Yalnızca MiniBrowser'ın trafiği tünelden geçer; diğer uygulamalar ve Windows ayarları etkilenmez.
- SSH ağınızda engelliyse tünel kurulamaz; MiniBrowser bunu aşmaya çalışmaz (ProxyCommand, port atlama vb. yoktur).
  **Kurumsal ağlarda VPN/tünel kullanmadan önce BT politikanızı kontrol edin.**
- MiniBrowser beklenmedik şekilde çökerse arka planda `ssh.exe` süreci kalabilir; Görev Yöneticisi'nden kapatılabilir.

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
  "tunnel": {
    "host": "sunucum.ornek.com",
    "port": 22,
    "user": "ali",
    "identityFile": "C:\\Users\\ali\\.ssh\\id_ed25519",
    "localPort": 0,
    "autoConnect": false,
    "sshPath": ""
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
| `tunnel.host` / `port` / `user` | SSH sunucusu, portu (varsayılan 22) ve kullanıcı adı |
| `tunnel.identityFile` | Özel anahtar yolu; boşsa ssh-agent / varsayılan anahtarlar |
| `tunnel.localPort` | Yerel SOCKS portu; `0` = otomatik, aksi halde 1024–65535 |
| `tunnel.autoConnect` | Açılışta VPN'e otomatik bağlan (ana sayfa tünel kurulduktan sonra yüklenir) |
| `tunnel.sshPath` | Boşsa otomatik bulunur |

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
   ├─ ssh\known_hosts ← VPN sunucu anahtarları
   ├─ logs\minibrowser.log
   └─ crashes\
```

## Güvenlik ve kurumsal politikalar

MiniBrowser kurumsal güvenlik kontrollerini **atlatmak için tasarlanmamıştır**:

- Sertifika doğrulaması devre dışı bırakılmaz; geçersiz sertifikalı siteler açılmaz (`--ignore-certificate-errors`,
  `certificate-error` işleyicisi vb. yoktur — testlerle denetlenir).
- Windows proxy, güvenlik duvarı veya kayıt defteri ayarları değiştirilmez; yönetici yetkisi istenmez.
- Harici süreç olarak yalnızca, kullanıcı VPN'i açtığında `ssh` başlatılır (kabuksuz, argüman dizisiyle).
- Varsayılan mod **Sistem**dir: kurumunuzun proxy/PAC ayarları kullanılır. Kurumsal ağda yalnızca kullanma
  yetkiniz olan proxy sunucularını girin ve BT politikalarınıza uyun. Ağ düzeyinde engelleme (güvenlik duvarı,
  TLS denetimi, AppLocker/WDAC) MiniBrowser tarafından aşılmaz; kurum uygulama çalıştırmayı kısıtlıyorsa
  BT ekibinizden onay alın.
- Tüm pencereler `contextIsolation`, `sandbox` ve `nodeIntegration: false` ile çalışır; arayüz sayfalarında CSP vardır.
- Adres çubuğunda yalnızca `http`/`https` açılır (`file:`, `javascript:`, `data:` engellenir).
- Kamera, mikrofon, konum, bildirim gibi izin istekleri varsayılan olarak reddedilir.
- Proxy parolaları diske yazılmaz.

Bilinen sınırlamalar: Chromium SOCKS5 kullanıcı adı/parola doğrulamasını desteklemez. VPN parola ile SSH
girişini desteklemez (yalnızca anahtar). Minimal bir tarayıcıdır; eklenti, yer imi ve indirme yöneticisi yoktur. Exe imzasızdır; SmartScreen uyarısı görülebilir
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
src/main/main.js        Ana süreç: pencere, sekmeler, proxy/VPN uygulama, IPC, hata sayfaları, kimlik doğrulama
src/main/tab-model.js   Sekme sırası, kısayollar (saf, test edilebilir)
src/main/tunnel.js      SSH tüneli: doğrulama, ssh argümanları, süreç yönetimi, hata mesajları
src/main/smoke.js       Yalnızca otomatik testler için başsız senaryolar
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

- **Birim:** proxy ve tünel doğrulama (enjeksiyon, seçenek gibi görünen değerler, port sınırları), ssh argümanları,
  ssh hata mesajları, sekme sırası ve kısayollar, config yükleme/bozuk dosya/BOM, veri klasörü önceliği,
  URL normalleştirme, ayar formu dönüşümü; sahte bir `ssh` ile tünel süreç yönetimi.
- **Statik:** BAT dosyası CRLF/ASCII, admin/sistem komutu içermez, etiket/parantez dengesi; kaynakta güvenlik
  ayarlarının gevşetilmediği, CSP ve dosya referansları.
- **Uçtan uca (12 test):** gerçek Chromium ile doğrudan, HTTP proxy ve SOCKS5 proxy üzerinden sayfa yükleme
  (DNS'te olmayan `.test` alan adı yalnızca proxy üzerinden açılabildiği için trafiğin proxy'den geçtiği kanıtlanır),
  HTTPS proxy kuralı, bypass, kapalı proxy hatası (`-130`), bozuk config, yazılamayan klasör; ayar ekranının DOM
  üzerinden doldurulup kaydedilmesi, geçersiz port/enjeksiyon reddi ve “Bağlantıyı test et”; sekmeler (`+`,
  `window.open`, kısayollar, tıklama, kapatma, geri açma); VPN düğmesiyle tünelden sayfa yükleme, tünel kopunca
  trafiğin engellenmesi (kill switch), kimlik doğrulama hatası ve kapatınca normale dönüş.

VPN testleri gerçek bir SSH sunucusu yerine `test/helpers/fake-ssh.js` kullanır: `ssh` gibi argüman alır ve
`-D` portunda SOCKS5 açar. Gerçek bir OpenSSH sunucusuna karşı otomatik test yoktur.

`--smoke-test`, `--smoke-url`, `--smoke-settings`, `--smoke-tabs`, `--smoke-tunnel` argümanları yalnızca otomatik testler içindir.
