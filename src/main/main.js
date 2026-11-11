'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, session, shell } = require('electron');

const { resolveDataDir, buildPaths, ensureWritableDirs } = require('./paths');
const { loadConfig, saveConfig, validateConfig, ConfigError } = require('./config');
const { toElectronProxyConfig, describeProxy, validateProxySettings, PROXY_TYPES } = require('./proxy');
const { normalizeInput, isAllowedUrl } = require('./url');
const { describeNetError, isProxyError } = require('./errors');

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload');
const TOOLBAR_HEIGHT = 48;

const argv = process.argv.slice(1);
const argValue = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const SMOKE_OUT = argValue('smoke-test'); // e2e testleri için başsız çalışma
const SMOKE_URL = argValue('smoke-url');
const SMOKE_SETTINGS = argValue('smoke-settings'); // ayar ekranı senaryosu (JSON dosyası)

// ---------------------------------------------------------------------------
// 1) Portable veri klasörleri — app "ready" olmadan ÖNCE ayarlanmalı.
// ---------------------------------------------------------------------------
let paths;
let startupError = null;
try {
  const dataDir = resolveDataDir({
    argv,
    env: process.env,
    execPath: process.execPath,
    isPackaged: app.isPackaged,
    appRoot: path.join(__dirname, '..', '..'),
  });
  paths = buildPaths(dataDir);
  ensureWritableDirs(paths);
  app.setPath('userData', paths.profileDir); // ayrı, uygulamaya özel profil
  app.setPath('sessionData', paths.profileDir);
  app.setPath('crashDumps', paths.crashDir);
  app.setAppLogsPath(paths.logsDir);
} catch (err) {
  startupError = err;
}

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}\n`;
  if (!SMOKE_OUT) process.stdout.write(line);
  try {
    if (paths) fs.appendFileSync(path.join(paths.logsDir, 'minibrowser.log'), line);
  } catch {
    /* log yazılamazsa sessizce geç */
  }
}

function writeSmokeResult(result) {
  if (!SMOKE_OUT) return;
  fs.writeFileSync(SMOKE_OUT, JSON.stringify(result, null, 2));
}

if (startupError) {
  app.whenReady().then(() => {
    if (SMOKE_OUT) writeSmokeResult({ ok: false, stage: 'startup', error: startupError.message });
    else dialog.showErrorBox('MiniBrowser başlatılamadı', startupError.message);
    app.exit(1);
  });
} else if (!SMOKE_OUT && !app.requestSingleInstanceLock()) {
  // Aynı profil iki kez açılırsa Chromium profili kilitlenir; ilk pencereye odaklan.
  app.quit();
} else {
  start();
}

// ---------------------------------------------------------------------------
// 2) Uygulama
// ---------------------------------------------------------------------------
function start() {
  let config;
  let configWarning = null;
  let mainWindow = null;
  let contentView = null;
  let settingsWindow = null;

  function readConfig() {
    try {
      const r = loadConfig(paths.configFile);
      config = r.config;
      configWarning = r.warning;
      if (r.created) log('Varsayılan yapılandırma oluşturuldu:', paths.configFile);
      if (r.warning) log('UYARI:', r.warning);
    } catch (err) {
      config = validateConfig({});
      configWarning = `Yapılandırma okunamadı, varsayılanlar kullanılıyor: ${err.message}`;
      log('HATA:', configWarning);
    }
  }

  async function applyProxy(ses, proxySettings) {
    const proxyConfig = toElectronProxyConfig(proxySettings);
    await ses.setProxy(proxyConfig);
    await ses.closeAllConnections(); // eski bağlantılar eski proxy ile kalmasın
    log('Proxy uygulandı:', describeProxy(proxySettings), JSON.stringify(proxyConfig));
  }

  function sendToolbar(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  }

  function proxyStatus() {
    return { label: describeProxy(config.proxy), mode: config.proxy.mode };
  }

  function layoutContent() {
    if (!mainWindow || !contentView) return;
    const [width, height] = mainWindow.getContentSize();
    contentView.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) });
  }

  function loadErrorPage(info, failedUrl) {
    const q = new URLSearchParams({
      title: info.title,
      hint: info.hint,
      code: String(info.code),
      name: info.name,
      url: failedUrl || '',
      proxy: isProxyError(info.code) ? '1' : '0',
    });
    contentView.webContents.loadFile(path.join(RENDERER, 'error.html'), { search: q.toString() });
  }

  function navigate(input) {
    const url = normalizeInput(input, config.searchUrl);
    if (!url) {
      sendToolbar('nav:error', 'Bu adres türü güvenlik nedeniyle açılamaz (yalnızca http/https).');
      return false;
    }
    contentView.webContents.loadURL(url).catch(() => {
      /* did-fail-load olayında işlenir */
    });
    return true;
  }

  function hardenContents(wc) {
    // Yeni pencereleri aynı görünümde aç; izin verilmeyen şemaları engelle.
    wc.setWindowOpenHandler(({ url }) => {
      if (isAllowedUrl(url)) wc.loadURL(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, url) => {
      if (!isAllowedUrl(url)) {
        event.preventDefault();
        log('Engellenen gezinme:', url);
      }
    });
  }

  function createMainWindow() {
    mainWindow = new BrowserWindow({
      width: config.window.width,
      height: config.window.height,
      minWidth: 400,
      minHeight: 300,
      show: !SMOKE_OUT,
      title: 'MiniBrowser',
      webPreferences: {
        preload: path.join(PRELOAD, 'toolbar-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    mainWindow.removeMenu();
    mainWindow.loadFile(path.join(RENDERER, 'browser.html'));
    mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

    contentView = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    mainWindow.contentView.addChildView(contentView);
    layoutContent();
    mainWindow.on('resize', layoutContent);

    const wc = contentView.webContents;
    hardenContents(wc);

    const pushNavState = () =>
      sendToolbar('nav:state', {
        url: wc.getURL().startsWith('file:') ? '' : wc.getURL(),
        title: wc.getTitle(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        loading: wc.isLoading(),
      });
    wc.on('did-start-loading', pushNavState);
    wc.on('did-stop-loading', pushNavState);
    wc.on('did-navigate', pushNavState);
    wc.on('did-navigate-in-page', pushNavState);
    wc.on('page-title-updated', (_e, title) => {
      mainWindow.setTitle(`${title} — MiniBrowser`);
      pushNavState();
    });
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3 = ERR_ABORTED (kullanıcı durdurdu)
      const info = describeNetError(code, desc);
      log('Yükleme hatası:', code, desc, url);
      if (SMOKE_OUT) return;
      if (isProxyError(code)) sendToolbar('nav:error', `${info.title}. Proxy ayarlarını kontrol edin.`);
      loadErrorPage(info, url);
    });
    wc.on('render-process-gone', (_e, details) => {
      log('Sayfa süreci sonlandı:', details.reason);
      loadErrorPage({ title: 'Sayfa çöktü', hint: 'Sayfayı yeniden yükleyin.', code: 0, name: details.reason }, wc.getURL());
    });

    mainWindow.webContents.once('did-finish-load', () => {
      sendToolbar('proxy:status', proxyStatus());
      if (configWarning) sendToolbar('nav:error', configWarning);
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
      contentView = null;
      if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
    });
    return wc;
  }

  function openSettings() {
    if (settingsWindow && !settingsWindow.isDestroyed()) return settingsWindow.focus();
    settingsWindow = new BrowserWindow({
      width: 560,
      height: 680,
      parent: mainWindow || undefined,
      modal: false,
      show: !SMOKE_OUT,
      title: 'MiniBrowser — Proxy Ayarları',
      resizable: true,
      webPreferences: {
        preload: path.join(PRELOAD, 'settings-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    settingsWindow.removeMenu();
    settingsWindow.webContents.on('will-navigate', (e) => e.preventDefault());
    settingsWindow.loadFile(path.join(RENDERER, 'settings.html'));
    settingsWindow.on('closed', () => (settingsWindow = null));
  }

  // Proxy (ve site) kimlik doğrulaması: kimlik bilgileri diske KAYDEDİLMEZ.
  function promptCredentials(parent, authInfo) {
    return new Promise((resolve) => {
      const win = new BrowserWindow({
        width: 400,
        height: 300,
        parent: parent || undefined,
        modal: !!parent,
        resizable: false,
        minimizable: false,
        title: 'Kimlik doğrulama',
        webPreferences: {
          preload: path.join(PRELOAD, 'auth-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      win.removeMenu();
      let done = false;
      const finish = (creds) => {
        if (done) return;
        done = true;
        ipcMain.removeHandler('auth:info');
        ipcMain.removeAllListeners('auth:submit');
        if (!win.isDestroyed()) win.close();
        resolve(creds);
      };
      ipcMain.handle('auth:info', () => ({
        isProxy: authInfo.isProxy,
        host: `${authInfo.host}:${authInfo.port}`,
        realm: authInfo.realm || '',
      }));
      ipcMain.on('auth:submit', (e, creds) => {
        if (e.sender !== win.webContents) return;
        finish(creds && typeof creds.username === 'string' ? creds : null);
      });
      win.on('closed', () => finish(null));
      win.loadFile(path.join(RENDERER, 'auth.html'));
    });
  }

  app.on('login', (event, _wc, _details, authInfo, callback) => {
    event.preventDefault();
    if (SMOKE_OUT) return callback(); // test modunda iptal
    promptCredentials(mainWindow, authInfo).then((creds) => {
      if (creds) callback(creds.username, String(creds.password ?? ''));
      else callback();
    });
  });

  // Sertifika hataları için özel işleyici YOK: Chromium varsayılanı (reddet) geçerlidir.
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-attach-webview', (e) => e.preventDefault()); // <webview> kullanılmaz
  });

  // ---- IPC: araç çubuğu --------------------------------------------------
  const fromToolbar = (e) => mainWindow && e.sender === mainWindow.webContents;
  ipcMain.on('nav:go', (e, input) => fromToolbar(e) && navigate(input));
  ipcMain.on('nav:back', (e) => fromToolbar(e) && contentView.webContents.navigationHistory.goBack());
  ipcMain.on('nav:forward', (e) => fromToolbar(e) && contentView.webContents.navigationHistory.goForward());
  ipcMain.on('nav:reload', (e) => fromToolbar(e) && contentView.webContents.reload());
  ipcMain.on('nav:stop', (e) => fromToolbar(e) && contentView.webContents.stop());
  ipcMain.on('nav:home', (e) => fromToolbar(e) && navigate(config.homepage));
  ipcMain.on('settings:open', (e) => fromToolbar(e) && openSettings());

  // ---- IPC: ayarlar ------------------------------------------------------
  const fromSettings = (e) => settingsWindow && e.sender === settingsWindow.webContents;
  ipcMain.handle('settings:get', (e) => {
    if (!fromSettings(e)) return null;
    return { config, proxyTypes: PROXY_TYPES, configFile: paths.configFile, profileDir: paths.profileDir };
  });

  ipcMain.handle('settings:save', async (e, candidate) => {
    if (!fromSettings(e)) return { ok: false, error: { field: 'root', message: 'Yetkisiz istek.' } };
    try {
      const next = validateConfig({ ...config, ...candidate, proxy: { ...config.proxy, ...(candidate?.proxy || {}) } });
      await applyProxy(session.defaultSession, next.proxy);
      config = saveConfig(paths.configFile, next);
      sendToolbar('proxy:status', proxyStatus());
      if (contentView && contentView.webContents.getURL()) contentView.webContents.reload();
      return { ok: true, config };
    } catch (err) {
      const field = err instanceof ConfigError ? err.field : 'root';
      log('Ayar kaydı başarısız:', err.message);
      // Hatalı ayar uygulanmışsa eski ayara geri dön.
      await applyProxy(session.defaultSession, config.proxy).catch(() => {});
      return { ok: false, error: { field, message: err.message } };
    }
  });

  ipcMain.handle('settings:test', async (e, proxyCandidate, testUrl) => {
    if (!fromSettings(e)) return { ok: false, message: 'Yetkisiz istek.' };
    let proxySettings;
    try {
      proxySettings = validateProxySettings({ ...config.proxy, ...(proxyCandidate || {}) });
    } catch (err) {
      return { ok: false, field: err.field, message: err.message };
    }
    const url = testUrl && isAllowedUrl(testUrl) && testUrl !== 'about:blank' ? testUrl : config.homepage;
    return testProxy(proxySettings, url);
  });

  ipcMain.on('settings:close', (e) => fromSettings(e) && settingsWindow.close());

  async function testProxy(proxySettings, url, timeoutMs = 10000) {
    // Kalıcı olmayan ayrı bir oturum: test, ana profili etkilemez.
    const ses = session.fromPartition(`minibrowser-test-${Date.now()}`, { cache: false });
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await ses.setProxy(toElectronProxyConfig(proxySettings));
      const resolved = await ses.resolveProxy(url);
      const res = await ses.fetch(url, { signal: controller.signal, redirect: 'manual', cache: 'no-store' });
      return {
        ok: res.status > 0 && res.status < 500 && res.status !== 407,
        status: res.status,
        elapsedMs: Date.now() - started,
        resolved,
        url,
        message: res.status === 407 ? 'Proxy kimlik doğrulaması istiyor (407).' : `HTTP ${res.status}`,
      };
    } catch (err) {
      const aborted = controller.signal.aborted;
      return {
        ok: false,
        elapsedMs: Date.now() - started,
        url,
        message: aborted ? `Zaman aşımı (${timeoutMs / 1000} sn)` : err.message,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- Yaşam döngüsü -----------------------------------------------------
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    readConfig();
    // Varsayılan olarak tüm izin isteklerini (kamera, konum, bildirim...) reddet.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
      cb(['fullscreen', 'clipboard-sanitized-write'].includes(permission))
    );
    try {
      await applyProxy(session.defaultSession, config.proxy);
    } catch (err) {
      log('Proxy uygulanamadı, sistem ayarına dönülüyor:', err.message);
      configWarning = `Proxy uygulanamadı: ${err.message}`;
      await session.defaultSession.setProxy({ mode: 'system' });
    }

    const wc = createMainWindow();

    if (SMOKE_OUT) return runSmoke(wc);
    navigate(config.homepage);
  });

  app.on('window-all-closed', () => app.quit());

  // E2E testleri için: sayfayı yükle, sonucu JSON'a yaz, çık.
  async function runSmoke(wc) {
    const url = SMOKE_URL || config.homepage;
    const result = {
      ok: false,
      url,
      userData: app.getPath('userData'),
      proxy: toElectronProxyConfig(config.proxy),
      warning: configWarning,
    };
    const timeout = setTimeout(() => {
      writeSmokeResult({ ...result, error: 'timeout' });
      app.exit(2);
    }, 30000);
    try {
      result.resolvedProxy = await session.defaultSession.resolveProxy(url);
      await new Promise((resolve) => {
        wc.once('did-finish-load', resolve);
        wc.once('did-fail-load', (_e, code, desc, _u, main) => {
          if (main) {
            result.errorCode = code;
            result.errorName = desc;
            resolve();
          }
        });
        wc.loadURL(url).catch(() => {});
      });
      result.title = wc.getTitle();
      result.body = await wc.executeJavaScript('document.body ? document.body.innerText : ""').catch(() => '');
      result.ok = result.errorCode == null;
      if (SMOKE_SETTINGS) {
        result.settings = await runSettingsScenario(JSON.parse(fs.readFileSync(SMOKE_SETTINGS, 'utf8')));
        result.ok = result.settings.ok;
      }
    } catch (err) {
      result.error = err.message;
    }
    clearTimeout(timeout);
    writeSmokeResult(result);
    app.exit(result.ok ? 0 : 3);
  }

  /**
   * Ayar ekranını gerçek DOM üzerinden sürer: formu doldurur, düğmeye basar,
   * sonucu okur ve isteğe bağlı ekran görüntüsü alır.
   */
  async function runSettingsScenario({ values = {}, action = 'save', screenshotDir = null }) {
    openSettings();
    const sw = settingsWindow.webContents;
    await new Promise((r) => (sw.isLoading() ? sw.once('did-finish-load', r) : r()));
    const js = (code) => sw.executeJavaScript(code);
    const waitFor = async (code, ms = 15000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await js(code)) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    };
    await waitFor(`document.getElementById('config-path').textContent.length > 0`);
    const loaded = await js(`({ mode: document.querySelector('input[name=mode]:checked')?.value, host: host.value, port: port.value })`);
    await js(`(() => {
      const v = ${JSON.stringify(values)};
      if (v.mode) { document.querySelector('input[name=mode][value="' + v.mode + '"]').checked = true; }
      for (const k of ['type', 'host', 'port', 'bypass', 'homepage']) if (k in v) document.getElementById(k).value = v[k];
      document.getElementById('form').dispatchEvent(new Event('change'));
      document.getElementById(${JSON.stringify(action === 'test' ? 'test' : 'save')}).click();
    })()`);
    // Hızlı doğrulama hatası (anında) ya da sunucu sonucu (ok/err) beklenir.
    await waitFor(`[...document.querySelectorAll('.error')].some(e => e.textContent) ||
      ['ok', 'err'].some(c => document.getElementById('result').classList.contains(c))`);
    const state = await js(`({
      resultClass: document.getElementById('result').className,
      resultText: document.getElementById('result').textContent,
      errors: Object.fromEntries([...document.querySelectorAll('.error')].filter(e => e.textContent).map(e => [e.id, e.textContent])),
    })`);
    if (screenshotDir) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      const shot = async (w, name) => fs.writeFileSync(path.join(screenshotDir, name), (await w.capturePage()).toPNG());
      await shot(sw, `settings-${action}.png`);
      await shot(mainWindow.webContents, 'toolbar.png');
    }
    let savedConfig = null;
    try {
      savedConfig = JSON.parse(fs.readFileSync(paths.configFile, 'utf8'));
    } catch {
      /* yok */
    }
    return { ok: true, loaded, ...state, savedConfig, toolbarBadge: await mainWindow.webContents.executeJavaScript(`document.getElementById('proxy-badge').textContent`) };
  }

  // Ayarlar ekranındaki "Veri klasörünü aç" düğmesi.
  ipcMain.on('app:open-data-dir', (e) => fromSettings(e) && shell.openPath(paths.dataDir));
}
