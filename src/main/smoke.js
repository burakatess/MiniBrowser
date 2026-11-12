'use strict';
/**
 * Yalnızca otomatik testler için (--smoke-test). Uygulamayı başsız sürer,
 * sonucu JSON dosyasına yazar ve çıkar. Normal kullanımda yüklenmez/çalışmaz.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createSmokeRunner(ctx) {
  const { SMOKE, app, session, fs, path, writeSmokeResult } = ctx;

  async function waitFor(fn, ms = 15000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await sleep(100);
    }
    return false;
  }

  /** wc'ye url yükler; {ok, errorCode, title, body} döndürür. */
  function load(wc, url) {
    return new Promise((resolve) => {
      const r = {};
      const onFinish = () => done();
      const onFail = (_e, code, desc, _u, main) => {
        if (!main) return;
        r.errorCode = code;
        r.errorName = desc;
        done();
      };
      const done = async () => {
        wc.removeListener('did-finish-load', onFinish);
        wc.removeListener('did-fail-load', onFail);
        r.title = wc.getTitle();
        r.body = await wc.executeJavaScript('document.body ? document.body.innerText : ""').catch(() => '');
        r.ok = r.errorCode == null;
        resolve(r);
      };
      wc.on('did-finish-load', onFinish);
      wc.on('did-fail-load', onFail);
      wc.loadURL(url).catch(() => {});
    });
  }

  const toolbarJs = (code) => ctx.mainWindow.webContents.executeJavaScript(code);
  const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

  async function shot(wc, dir, name) {
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), (await wc.capturePage()).toPNG());
  }

  // ---- Ayar ekranı -------------------------------------------------------
  async function runSettingsScenario({ values = {}, tunnel = null, action = 'save', screenshotDir = null }) {
    ctx.openSettings();
    const sw = ctx.settingsWindow.webContents;
    await new Promise((r) => (sw.isLoading() ? sw.once('did-finish-load', r) : r()));
    const js = (code) => sw.executeJavaScript(code);
    await waitFor(() => js(`document.getElementById('config-path').textContent.length > 0`));
    const loaded = await js(`({ mode: document.querySelector('input[name=mode]:checked')?.value, host: host.value, port: port.value })`);
    const buttonId = { save: 'save', test: 'test', connect: 'tunnel-connect' }[action] || 'save';
    await js(`(() => {
      const v = ${JSON.stringify(values)};
      const t = ${JSON.stringify(tunnel || {})};
      if (v.mode) document.querySelector('input[name=mode][value="' + v.mode + '"]').checked = true;
      for (const k of ['type', 'host', 'port', 'bypass', 'homepage']) if (k in v) document.getElementById(k).value = v[k];
      for (const k of Object.keys(t)) {
        const el = document.getElementById('t-' + k);
        if (el.type === 'checkbox') el.checked = !!t[k]; else el.value = t[k];
      }
      document.getElementById('form').dispatchEvent(new Event('change'));
      document.getElementById(${JSON.stringify(buttonId)}).click();
    })()`);
    // Hızlı doğrulama hatası (anında) ya da sunucu sonucu (ok/err) beklenir.
    await waitFor(() =>
      js(`[...document.querySelectorAll('.error')].some(e => e.textContent) ||
        ['ok', 'err'].some(c => document.getElementById('result').classList.contains(c))`)
    );
    const state = await js(`({
      resultClass: document.getElementById('result').className,
      resultText: document.getElementById('result').textContent,
      errors: Object.fromEntries([...document.querySelectorAll('.error')].filter(e => e.textContent).map(e => [e.id, e.textContent])),
    })`);
    await shot(sw, screenshotDir, `settings-${action}.png`);
    await shot(ctx.mainWindow.webContents, screenshotDir, 'toolbar.png');
    let savedConfig = null;
    try {
      savedConfig = readJson(ctx.paths.configFile);
    } catch {
      /* yok */
    }
    return {
      ok: true,
      loaded,
      ...state,
      savedConfig,
      toolbarBadge: await toolbarJs(`document.getElementById('proxy-badge').textContent`),
    };
  }

  // ---- Sekmeler ----------------------------------------------------------
  async function runTabsScenario(baseUrl, { screenshotDir = null } = {}) {
    const steps = {};
    const domTabs = () =>
      toolbarJs(`[...document.querySelectorAll('#tabs .tab')].map(t => ({
        id: Number(t.dataset.id), title: t.querySelector('.title').textContent, active: t.classList.contains('active') }))`);
    const snapshot = async () => ({ order: [...ctx.order], activeId: ctx.activeId, dom: await domTabs() });

    const first = ctx.activeId;
    // 1) Araç çubuğundaki "+" düğmesi
    await toolbarJs(`document.getElementById('new-tab').click()`);
    await waitFor(() => ctx.order.length === 2);
    await load(ctx.activeWc(), `${baseUrl}?sekme=2`);
    steps.afterPlus = await snapshot();

    // 2) Sayfadan window.open -> yeni sekme (etkin)
    await ctx.activeWc().executeJavaScript(`window.open(${JSON.stringify(`${baseUrl}?sekme=3`)}, '_blank')`, true);
    await waitFor(() => ctx.order.length === 3);
    await waitFor(async () => !ctx.activeWc().isLoading() && ctx.activeWc().getURL().includes('sekme=3'));
    steps.afterWindowOpen = await snapshot();

    // 3) Klavye kısayolları: Ctrl+1 ilk sekme, Ctrl+Tab sonraki, Ctrl+9 son
    ctx.handleShortcut({ type: 'select', n: 1 });
    steps.afterCtrl1 = ctx.activeId;
    ctx.handleShortcut({ type: 'cycle', dir: 1 });
    steps.afterCtrlTab = ctx.activeId;
    ctx.handleShortcut({ type: 'select', n: 9 });
    steps.afterCtrl9 = ctx.activeId;

    // 4) Sekme şeridine tıklayarak seçme
    await toolbarJs(`document.querySelector('#tabs .tab[data-id="${first}"]').click()`);
    await waitFor(() => ctx.activeId === first);
    steps.afterClickFirst = ctx.activeId;

    // 5) Ortadaki sekmeyi "×" ile kapat, sonra Ctrl+W ile etkin olanı kapat
    const middle = ctx.order[1];
    await toolbarJs(`document.querySelector('#tabs .tab[data-id="${middle}"] .close').click()`);
    await waitFor(() => ctx.order.length === 2);
    steps.afterCloseMiddle = await snapshot();
    ctx.handleShortcut({ type: 'close' });
    steps.afterCtrlW = await snapshot();

    // 6) Ctrl+Shift+T kapatılan sekmeyi geri açar
    ctx.handleShortcut({ type: 'reopen' });
    await waitFor(() => ctx.order.length === 2);
    await waitFor(async () => ctx.activeWc() && !ctx.activeWc().isLoading() && ctx.activeWc().getURL() !== '');
    steps.afterReopen = { ...(await snapshot()), url: ctx.activeWc().getURL() };

    // 7) Her sekmenin kendi geçmişi var
    steps.urls = ctx.order.map((id) => (id === ctx.activeId ? ctx.activeWc().getURL() : null));
    await sleep(200);
    await shot(ctx.mainWindow.webContents, screenshotDir, 'tabs-toolbar.png');
    return { ok: true, firstId: first, ...steps };
  }

  // ---- SSH tüneli --------------------------------------------------------
  async function runTunnelScenario(url, { crash = true, screenshotDir = null } = {}) {
    const r = { states: [] };
    ctx.tunnel.on('state', (s) => r.states.push(s.state));
    r.before = await session.defaultSession.resolveProxy(url);

    // Araç çubuğundaki VPN düğmesiyle bağlan
    await toolbarJs(`document.getElementById('vpn').click()`);
    r.connected = await waitFor(() => ctx.tunnel.state === 'connected' || ctx.tunnel.state === 'error', 25000);
    r.statusAfterConnect = ctx.tunnelStatus();
    r.during = await session.defaultSession.resolveProxy(url);
    r.page = await load(ctx.activeWc(), url);
    await sleep(300);
    r.vpnButton = await toolbarJs(`({ text: document.getElementById('vpn').textContent, cls: document.getElementById('vpn').className })`);
    await shot(ctx.mainWindow.webContents, screenshotDir, 'vpn-toolbar.png');

    if (crash && ctx.tunnel.child) {
      // Tünel süreci beklenmedik şekilde ölürse trafik tünelsiz akmamalı (kill switch)
      ctx.tunnel.child.kill('SIGKILL');
      await waitFor(() => ctx.tunnel.state === 'error', 10000);
      r.statusAfterCrash = ctx.tunnelStatus();
      r.afterCrashProxy = await session.defaultSession.resolveProxy(url);
      r.pageAfterCrash = await load(ctx.activeWc(), url);
    }

    // Düğmeyle kapat -> normal proxy ayarına dönülür
    await toolbarJs(`document.getElementById('vpn').click()`);
    await waitFor(() => ctx.tunnel.state === 'idle', 10000);
    r.statusAfterDisconnect = ctx.tunnelStatus();
    r.after = await session.defaultSession.resolveProxy(url);
    r.knownHostsDir = fs.existsSync(path.join(ctx.paths.dataDir, 'ssh'));
    r.ok = true;
    return r;
  }

  async function run() {
    const url = SMOKE.url || ctx.config.homepage;
    const result = {
      ok: false,
      url,
      userData: app.getPath('userData'),
      proxy: ctx.toElectronProxyConfig(ctx.config.proxy),
      warning: ctx.configWarning,
    };
    const timeout = setTimeout(() => {
      writeSmokeResult({ ...result, error: 'timeout' });
      app.exit(2);
    }, 60000);
    try {
      await new Promise((r) => (ctx.mainWindow.webContents.isLoading() ? ctx.mainWindow.webContents.once('did-finish-load', r) : r()));
      ctx.createTab(null);
      result.resolvedProxy = await session.defaultSession.resolveProxy(url);
      if (SMOKE.tunnel) {
        result.tunnel = await runTunnelScenario(url, readJson(SMOKE.tunnel));
        result.ok = result.tunnel.ok;
      } else {
        Object.assign(result, await load(ctx.activeWc(), url));
        if (SMOKE.settings) {
          result.settings = await runSettingsScenario(readJson(SMOKE.settings));
          result.ok = result.settings.ok;
        }
        if (SMOKE.tabs) {
          result.tabs = await runTabsScenario(url, readJson(SMOKE.tabs));
          result.ok = result.ok && result.tabs.ok;
        }
      }
    } catch (err) {
      result.error = `${err.message}\n${err.stack}`;
      result.ok = false;
    }
    clearTimeout(timeout);
    writeSmokeResult(result);
    ctx.tunnel.killNow();
    app.exit(result.ok ? 0 : 3);
  }

  return { run };
}

module.exports = { createSmokeRunner };
