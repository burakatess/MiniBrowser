'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, session, shell } = require('electron');

const { resolveDataDir, buildPaths, ensureWritableDirs } = require('./paths');
const { loadConfig, saveConfig, validateConfig, ConfigError } = require('./config');
const { toElectronProxyConfig, describeProxy, validateProxySettings, PROXY_TYPES } = require('./proxy');
const { normalizeInput, isAllowedUrl } = require('./url');
const { describeNetError, isProxyError } = require('./errors');
const { SshTunnel, validateTunnelSettings, findFreePort } = require('./tunnel');
const tabModel = require('./tab-model');
const { createSmokeRunner } = require('./smoke');

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload');
const TOOLBAR_HEIGHT = 84; // sekme şeridi (36) + gezinme çubuğu (48)

const argv = process.argv.slice(1);
const argValue = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const SMOKE = {
  out: argValue('smoke-test'), // e2e testleri için başsız çalışma
  url: argValue('smoke-url'),
  settings: argValue('smoke-settings'),
  tabs: argValue('smoke-tabs'),
  tunnel: argValue('smoke-tunnel'),
};

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
  if (!SMOKE.out) process.stdout.write(line);
  try {
    if (paths) fs.appendFileSync(path.join(paths.logsDir, 'minibrowser.log'), line);
  } catch {
    /* log yazılamazsa sessizce geç */
  }
}

function writeSmokeResult(result) {
  if (SMOKE.out) fs.writeFileSync(SMOKE.out, JSON.stringify(result, null, 2));
}

if (startupError) {
  app.whenReady().then(() => {
    if (SMOKE.out) writeSmokeResult({ ok: false, stage: 'startup', error: startupError.message });
    else dialog.showErrorBox('MiniBrowser başlatılamadı', startupError.message);
    app.exit(1);
  });
} else if (!SMOKE.out && !app.requestSingleInstanceLock()) {
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
  let settingsWindow = null;

  /** @type {Map<number, {id:number, view: WebContentsView}>} */
  const tabs = new Map();
  let order = []; // sekme kimlikleri, soldan sağa
  let activeId = null;
  let nextTabId = 1;
  const closedUrls = []; // Ctrl+Shift+T için

  // SSH tüneli. `tunnelWanted`: kullanıcı tüneli açtı mı? Açıkken tünel kopsa
  // bile trafik tünelin yerel portuna yönlendirilmeye devam eder (kill switch);
  // böylece sayfalar sessizce tünelsiz yüklenmez.
  const tunnel = new SshTunnel({ knownHostsFile: path.join(paths.dataDir, 'ssh', 'known_hosts'), log });
  let tunnelWanted = false;

  // ---- Yapılandırma ve proxy --------------------------------------------
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

  /** Şu anda geçerli olması gereken proxy ayarı (tünel açıksa tünelin SOCKS5 portu). */
  function effectiveProxy() {
    if (tunnelWanted && tunnel.localPort) {
      return { mode: 'manual', type: 'socks5', host: '127.0.0.1', port: tunnel.localPort, bypass: [] };
    }
    return config.proxy;
  }

  async function applyProxy(proxySettings = effectiveProxy()) {
    const ses = session.defaultSession;
    const proxyConfig = toElectronProxyConfig(proxySettings);
    await ses.setProxy(proxyConfig);
    await ses.closeAllConnections(); // eski bağlantılar eski proxy ile kalmasın
    log('Proxy uygulandı:', describeProxy(proxySettings), JSON.stringify(proxyConfig));
  }

  function sendToolbar(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  }

  function proxyStatus() {
    return { label: describeProxy(config.proxy), mode: config.proxy.mode, overridden: tunnelWanted };
  }

  function tunnelStatus() {
    const configured = Boolean(config.tunnel.host && config.tunnel.user);
    return { ...tunnel.status(), wanted: tunnelWanted, configured };
  }

  function pushStatus() {
    sendToolbar('proxy:status', proxyStatus());
    sendToolbar('tunnel:status', tunnelStatus());
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('tunnel:status', tunnelStatus());
  }

  // ---- SSH tüneli --------------------------------------------------------
  tunnel.on('state', async (s) => {
    log('Tünel durumu:', s.state, s.message);
    if (s.state === 'connecting' && tunnelWanted) {
      // Bağlanırken de tünel portuna yönlendir: bu sürede trafik dışarı sızmaz.
      await applyProxy().catch((err) => log('Proxy uygulanamadı:', err.message));
    }
    if (s.state === 'connected') reloadAllTabs();
    if (s.state === 'error' && tunnelWanted) {
      sendToolbar('nav:error', `VPN (SSH tüneli) bağlantısı yok: ${s.message} Sayfalar tünel olmadan açılmaz; “VPN” düğmesiyle kapatabilirsiniz.`);
    }
    pushStatus();
  });

  async function connectTunnel() {
    if (tunnelWanted) return tunnelStatus();
    try {
      validateTunnelSettings(config.tunnel, { requireComplete: true });
    } catch (err) {
      sendToolbar('nav:error', `VPN için önce ayarlardan SSH sunucusunu girin: ${err.message}`);
      openSettings();
      return { ...tunnelStatus(), error: err.message };
    }
    // Portu önce seç ve trafiği HEMEN tünel portuna yönlendir: tünel hazır
    // olana dek sayfalar tünelsiz yüklenmez (kill switch).
    const localPort = config.tunnel.localPort || (await findFreePort());
    tunnelWanted = true;
    tunnel.localPort = localPort;
    await applyProxy().catch((err) => log('Proxy uygulanamadı:', err.message));
    pushStatus();
    try {
      await tunnel.start({ ...config.tunnel, localPort });
      return tunnelStatus();
    } catch (err) {
      // Kill switch açık kalır; kullanıcı "VPN" düğmesiyle kapatana dek trafik tünelsiz akmaz.
      if (tunnel.state !== 'error') tunnel.setState('error', err.message);
      sendToolbar('nav:error', `VPN bağlanamadı: ${err.message} Kapatmak için “VPN” düğmesine basın.`);
      pushStatus();
      return { ...tunnelStatus(), error: err.message };
    }
  }

  async function disconnectTunnel() {
    tunnelWanted = false;
    await tunnel.stop();
    tunnel.localPort = null;
    await applyProxy().catch((err) => log('Proxy uygulanamadı:', err.message));
    reloadAllTabs();
    pushStatus();
    return tunnelStatus();
  }

  // ---- Sekmeler ----------------------------------------------------------
  const activeTab = () => (activeId == null ? null : tabs.get(activeId));
  const activeWc = () => activeTab()?.view.webContents ?? null;

  function tabInfo(tab) {
    const wc = tab.view.webContents;
    const url = wc.getURL();
    const isInternal = url.startsWith('file:');
    return {
      id: tab.id,
      title: wc.getTitle() || (isInternal ? 'Hata' : url) || 'Yeni sekme',
      url: isInternal ? '' : url,
      loading: wc.isLoading(),
    };
  }

  function pushTabs() {
    sendToolbar('tabs:state', { tabs: order.map((id) => tabInfo(tabs.get(id))), activeId });
  }

  function pushNavState() {
    const wc = activeWc();
    if (!wc) return;
    const info = tabInfo(activeTab());
    sendToolbar('nav:state', {
      url: info.url,
      title: info.title,
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading(),
    });
    if (mainWindow) mainWindow.setTitle(`${info.title} — MiniBrowser`);
  }

  function layout() {
    const tab = activeTab();
    if (!mainWindow || !tab) return;
    const [width, height] = mainWindow.getContentSize();
    tab.view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) });
  }

  function loadErrorPage(wc, info, failedUrl) {
    const q = new URLSearchParams({
      title: info.title,
      hint: info.hint,
      code: String(info.code),
      name: info.name,
      url: failedUrl || '',
      proxy: isProxyError(info.code) ? '1' : '0',
      tunnel: tunnelWanted ? '1' : '0',
    });
    wc.loadFile(path.join(RENDERER, 'error.html'), { search: q.toString() });
  }

  function loadInto(wc, input) {
    const url = normalizeInput(input, config.searchUrl);
    if (!url) {
      sendToolbar('nav:error', 'Bu adres türü güvenlik nedeniyle açılamaz (yalnızca http/https).');
      return false;
    }
    wc.loadURL(url).catch(() => {
      /* did-fail-load olayında işlenir */
    });
    return true;
  }

  function handleShortcut(action) {
    switch (action.type) {
      case 'new':
        return createTab(config.homepage, { focusAddress: true });
      case 'reopen':
        return closedUrls.length && createTab(closedUrls.pop());
      case 'close':
        return activeId != null && closeTab(activeId);
      case 'cycle':
        return activateTab(tabModel.cycle(order, activeId, action.dir));
      case 'select':
        return activateTab(tabModel.byShortcutNumber(order, action.n));
      case 'reload':
        return activeWc()?.reload();
      case 'back':
        return activeWc()?.navigationHistory.goBack();
      case 'forward':
        return activeWc()?.navigationHistory.goForward();
      case 'focus-address':
        mainWindow.webContents.focus();
        return sendToolbar('ui:focus-address');
      default:
        return null;
    }
  }

  function attachShortcuts(wc) {
    wc.on('before-input-event', (event, input) => {
      const action = tabModel.shortcutAction(input);
      if (!action) return;
      event.preventDefault();
      handleShortcut(action);
    });
  }

  /**
   * Yeni sekme açar.
   * @param {string|null} url  null ise boş sekme
   * @param {{activate?: boolean, openerId?: number|null, focusAddress?: boolean}} opts
   */
  function createTab(url, { activate = true, openerId = null, focusAddress = false } = {}) {
    if (!mainWindow) return null;
    if (tabs.size >= tabModel.MAX_TABS) {
      sendToolbar('nav:error', `En fazla ${tabModel.MAX_TABS} sekme açılabilir.`);
      return null;
    }
    const id = nextTabId++;
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const tab = { id, view };
    tabs.set(id, tab);
    order.splice(tabModel.insertIndex(order, openerId), 0, id);
    view.setVisible(false);
    mainWindow.contentView.addChildView(view);

    const wc = view.webContents;
    attachShortcuts(wc);

    // Yeni pencere istekleri (target=_blank, window.open, orta tık) yeni sekmede açılır.
    wc.setWindowOpenHandler(({ url: target, disposition }) => {
      if (isAllowedUrl(target)) createTab(target, { activate: disposition !== 'background-tab', openerId: id });
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, target) => {
      if (!isAllowedUrl(target)) {
        event.preventDefault();
        log('Engellenen gezinme:', target);
      }
    });

    const changed = () => {
      pushTabs();
      if (id === activeId) pushNavState();
    };
    for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) {
      wc.on(ev, changed);
    }
    wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3 = ERR_ABORTED (kullanıcı durdurdu)
      const info = describeNetError(code, desc);
      log('Yükleme hatası:', code, desc, failedUrl);
      if (SMOKE.out) return;
      if (isProxyError(code) && id === activeId) {
        sendToolbar('nav:error', `${info.title}. ${tunnelWanted ? 'VPN (SSH tüneli) bağlantısını' : 'Proxy ayarlarını'} kontrol edin.`);
      }
      loadErrorPage(wc, info, failedUrl);
    });
    wc.on('render-process-gone', (_e, details) => {
      log('Sayfa süreci sonlandı:', details.reason);
      loadErrorPage(wc, { title: 'Sayfa çöktü', hint: 'Sayfayı yeniden yükleyin.', code: 0, name: details.reason }, wc.getURL());
    });

    if (url) loadInto(wc, url);
    if (activate || activeId == null) activateTab(id);
    else pushTabs();
    if (focusAddress) handleShortcut({ type: 'focus-address' });
    return tab;
  }

  function activateTab(id) {
    if (id == null || !tabs.has(id)) return;
    const prev = activeTab();
    if (prev && prev.id !== id) prev.view.setVisible(false);
    activeId = id;
    const tab = tabs.get(id);
    layout();
    tab.view.setVisible(true);
    if (!mainWindow.webContents.isFocused()) tab.view.webContents.focus();
    pushTabs();
    pushNavState();
  }

  function closeTab(id) {
    const tab = tabs.get(id);
    if (!tab) return;
    const url = tab.view.webContents.getURL();
    if (url && !url.startsWith('file:')) {
      closedUrls.push(url);
      if (closedUrls.length > 20) closedUrls.shift();
    }
    const nextId = tabModel.nextActiveAfterClose(order, id, activeId);
    order = order.filter((x) => x !== id);
    tabs.delete(id);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
    if (nextId == null) {
      // Son sekme kapandı: Chrome gibi pencereyi kapat.
      activeId = null;
      if (mainWindow && !SMOKE.out) mainWindow.close();
      return;
    }
    activeId = null;
    activateTab(nextId);
  }

  function reloadAllTabs() {
    for (const tab of tabs.values()) {
      const wc = tab.view.webContents;
      if (wc.getURL()) wc.reload();
    }
  }

  // ---- Pencereler --------------------------------------------------------
  function createMainWindow() {
    mainWindow = new BrowserWindow({
      width: config.window.width,
      height: config.window.height,
      minWidth: 480,
      minHeight: 320,
      show: !SMOKE.out,
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
    attachShortcuts(mainWindow.webContents);
    mainWindow.on('resize', layout);

    mainWindow.webContents.once('did-finish-load', () => {
      pushStatus();
      pushTabs();
      pushNavState();
      if (configWarning) sendToolbar('nav:error', configWarning);
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
      tabs.clear();
      order = [];
      activeId = null;
      if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
    });
  }

  function openSettings() {
    if (settingsWindow && !settingsWindow.isDestroyed()) return settingsWindow.focus();
    settingsWindow = new BrowserWindow({
      width: 580,
      height: 760,
      parent: mainWindow || undefined,
      modal: false,
      show: !SMOKE.out,
      title: 'MiniBrowser — Ayarlar',
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
    if (SMOKE.out) return callback(); // test modunda iptal
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
  const onToolbar = (channel, fn) => ipcMain.on(channel, (e, ...args) => fromToolbar(e) && fn(...args));
  onToolbar('nav:go', (input) => activeWc() && loadInto(activeWc(), input));
  onToolbar('nav:back', () => activeWc()?.navigationHistory.goBack());
  onToolbar('nav:forward', () => activeWc()?.navigationHistory.goForward());
  onToolbar('nav:reload', () => activeWc()?.reload());
  onToolbar('nav:stop', () => activeWc()?.stop());
  onToolbar('nav:home', () => activeWc() && loadInto(activeWc(), config.homepage));
  onToolbar('settings:open', () => openSettings());
  onToolbar('tab:new', () => createTab(config.homepage, { focusAddress: true }));
  onToolbar('tab:select', (id) => activateTab(Number(id)));
  onToolbar('tab:close', (id) => closeTab(Number(id)));
  onToolbar('tunnel:toggle', () => (tunnelWanted ? disconnectTunnel() : connectTunnel()));

  // ---- IPC: ayarlar ------------------------------------------------------
  const fromSettings = (e) => settingsWindow && e.sender === settingsWindow.webContents;
  ipcMain.handle('settings:get', (e) => {
    if (!fromSettings(e)) return null;
    return {
      config,
      proxyTypes: PROXY_TYPES,
      configFile: paths.configFile,
      profileDir: paths.profileDir,
      tunnel: tunnelStatus(),
      platform: process.platform,
    };
  });

  ipcMain.handle('settings:save', async (e, candidate) => {
    if (!fromSettings(e)) return { ok: false, error: { field: 'root', message: 'Yetkisiz istek.' } };
    try {
      const next = validateConfig({
        ...config,
        ...candidate,
        proxy: { ...config.proxy, ...(candidate?.proxy || {}) },
        tunnel: { ...config.tunnel, ...(candidate?.tunnel || {}) },
      });
      const prev = config;
      config = next;
      try {
        await applyProxy(); // tünel açıksa tünel geçerli kalır
      } catch (err) {
        config = prev;
        throw err;
      }
      config = saveConfig(paths.configFile, next);
      pushStatus();
      const wc = activeWc();
      if (wc && wc.getURL()) wc.reload();
      return { ok: true, config, tunnel: tunnelStatus() };
    } catch (err) {
      const field = err instanceof ConfigError ? err.field : 'root';
      log('Ayar kaydı başarısız:', err.message);
      await applyProxy().catch(() => {});
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

  ipcMain.handle('tunnel:connect', (e) => (fromSettings(e) ? connectTunnel() : null));
  ipcMain.handle('tunnel:disconnect', (e) => (fromSettings(e) ? disconnectTunnel() : null));
  ipcMain.handle('settings:pick-key', async (e) => {
    if (!fromSettings(e)) return null;
    const r = await dialog.showOpenDialog(settingsWindow, {
      title: 'SSH özel anahtarını seçin',
      properties: ['openFile', 'showHiddenFiles'],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.on('settings:close', (e) => fromSettings(e) && settingsWindow.close());
  ipcMain.on('app:open-data-dir', (e) => fromSettings(e) && shell.openPath(paths.dataDir));

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

  // Uygulama kapanırken ssh sürecini geride bırakma.
  app.on('will-quit', () => tunnel.killNow());
  process.on('exit', () => tunnel.killNow());

  app.whenReady().then(async () => {
    readConfig();
    // Varsayılan olarak tüm izin isteklerini (kamera, konum, bildirim...) reddet.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
      cb(['fullscreen', 'clipboard-sanitized-write'].includes(permission))
    );
    try {
      await applyProxy();
    } catch (err) {
      log('Proxy uygulanamadı, sistem ayarına dönülüyor:', err.message);
      configWarning = `Proxy uygulanamadı: ${err.message}`;
      await session.defaultSession.setProxy({ mode: 'system' });
    }

    createMainWindow();

    if (SMOKE.out) {
      const runner = createSmokeRunner({
        SMOKE,
        app,
        session,
        fs,
        path,
        writeSmokeResult,
        get config() {
          return config;
        },
        get configWarning() {
          return configWarning;
        },
        get mainWindow() {
          return mainWindow;
        },
        get settingsWindow() {
          return settingsWindow;
        },
        get order() {
          return order;
        },
        get activeId() {
          return activeId;
        },
        paths,
        tunnel,
        createTab,
        closeTab,
        activateTab,
        activeWc,
        handleShortcut,
        openSettings,
        connectTunnel,
        disconnectTunnel,
        tunnelStatus,
        toElectronProxyConfig,
      });
      return runner.run();
    }

    if (config.tunnel.autoConnect) {
      // Önce tüneli kur, ana sayfayı sonra yükle (ilk istek tünelsiz gitmesin).
      createTab(null);
      connectTunnel().then(() => activeWc() && loadInto(activeWc(), config.homepage));
    } else {
      createTab(config.homepage);
    }
  });

  app.on('window-all-closed', () => app.quit());
}
