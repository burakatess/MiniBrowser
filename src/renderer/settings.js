'use strict';
const { DEFAULT_PORTS, TYPE_HINTS, formToConfig, configToForm, quickValidate, quickValidateTunnel } = window.SettingsForm;
const $ = (id) => document.getElementById(id);
const form = $('form');
const TUNNEL_KEYS = ['host', 'port', 'user', 'identityFile', 'localPort', 'sshPath'];
const FIELDS = ['host', 'port', 'bypass', 'homepage', ...TUNNEL_KEYS.map((k) => `t-${k}`)];

function readForm() {
  const tunnel = {};
  for (const k of TUNNEL_KEYS) tunnel[k] = $(`t-${k}`).value;
  tunnel.autoConnect = $('t-autoConnect').checked;
  return {
    mode: form.querySelector('input[name=mode]:checked')?.value || 'system',
    type: $('type').value,
    host: $('host').value,
    port: $('port').value,
    bypass: $('bypass').value,
    homepage: $('homepage').value,
    tunnel,
  };
}

function fillForm(v) {
  const radio = form.querySelector(`input[name=mode][value="${v.mode}"]`);
  if (radio) radio.checked = true;
  $('type').value = v.type;
  $('host').value = v.host;
  $('port').value = v.port;
  $('bypass').value = v.bypass;
  $('homepage').value = v.homepage;
  for (const k of TUNNEL_KEYS) $(`t-${k}`).value = v.tunnel[k];
  $('t-autoConnect').checked = v.tunnel.autoConnect;
  refresh();
}

function refresh() {
  const v = readForm();
  $('manual-fields').disabled = v.mode !== 'manual';
  $('type-hint').textContent = TYPE_HINTS[v.type] || '';
}

function showErrors(errors) {
  for (const f of FIELDS) {
    const msg = errors[f] || '';
    $(`err-${f}`).textContent = msg;
    $(f).setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  const first = FIELDS.find((f) => errors[f]);
  if (first) {
    if (first === 't-sshPath') $(first).closest('details').open = true;
    $(first).focus();
  }
}

function showResult(kind, text) {
  const el = $('result');
  el.className = `result ${kind}`;
  el.textContent = text;
}

function fieldFromServer(field) {
  // "proxy.host" -> "host", "tunnel.host" -> "t-host"
  const f = String(field || '');
  const mapped = f.startsWith('tunnel.') ? `t-${f.slice(7)}` : f.replace(/^proxy\./, '');
  return FIELDS.includes(mapped) ? mapped : null;
}

function busy(on) {
  for (const id of ['test', 'save', 'tunnel-connect', 'tunnel-disconnect']) $(id).disabled = on;
}

const TUNNEL_LABELS = { idle: 'Kapalı', connecting: 'Bağlanıyor…', connected: 'Bağlı', error: 'Hata' };
function renderTunnel(t) {
  if (!t) return;
  const state = t.wanted ? t.state : 'idle';
  $('tunnel-state').className = `pill ${state}`;
  $('tunnel-state').textContent = TUNNEL_LABELS[state] || state;
  $('tunnel-message').textContent = t.wanted || t.state === 'error' ? t.message || '' : '';
  $('tunnel-connect').classList.toggle('hidden', !!t.wanted);
  $('tunnel-disconnect').classList.toggle('hidden', !t.wanted);
}

async function save(cfg) {
  const r = await window.settingsApi.save(cfg);
  if (r.ok) {
    fillForm(configToForm(r.config));
    renderTunnel(r.tunnel);
  } else {
    const f = fieldFromServer(r.error.field);
    if (f) showErrors({ [f]: r.error.message });
    showResult('err', `Kaydedilemedi: ${r.error.message}`);
  }
  return r;
}

form.addEventListener('change', refresh);

$('type').addEventListener('change', () => {
  // Port varsayılan değerdeyse türe göre güncelle.
  const port = $('port').value.trim();
  if (!port || Object.values(DEFAULT_PORTS).map(String).includes(port)) $('port').value = DEFAULT_PORTS[$('type').value];
});

$('test').addEventListener('click', async () => {
  const cfg = formToConfig(readForm());
  const errors = quickValidate(cfg);
  showErrors(errors);
  if (Object.keys(errors).length) return;
  busy(true);
  showResult('info', `Test ediliyor: ${cfg.homepage} …`);
  try {
    const r = await window.settingsApi.test(cfg.proxy, cfg.homepage);
    if (r.field) showErrors({ [fieldFromServer(r.field)]: r.message });
    const via = r.resolved ? ` • Yol: ${r.resolved}` : '';
    showResult(r.ok ? 'ok' : 'err', `${r.ok ? '✓ Bağlantı başarılı' : '✗ Bağlantı başarısız'} — ${r.message} (${r.elapsedMs ?? 0} ms)${via}`);
  } catch (err) {
    showResult('err', `Test çalıştırılamadı: ${err.message}`);
  } finally {
    busy(false);
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cfg = formToConfig(readForm());
  const errors = quickValidate(cfg);
  showErrors(errors);
  if (Object.keys(errors).length) return;
  busy(true);
  try {
    const r = await save(cfg);
    if (r.ok) showResult('ok', '✓ Kaydedildi ve uygulandı. Sayfa yeniden yükleniyor.');
  } catch (err) {
    showResult('err', `Kaydedilemedi: ${err.message}`);
  } finally {
    busy(false);
  }
});

$('tunnel-connect').addEventListener('click', async () => {
  const cfg = formToConfig(readForm());
  const errors = { ...quickValidate(cfg), ...quickValidateTunnel(cfg.tunnel, { forConnect: true }) };
  showErrors(errors);
  if (Object.keys(errors).length) return;
  busy(true);
  showResult('info', `VPN bağlanıyor: ${cfg.tunnel.user}@${cfg.tunnel.host}:${cfg.tunnel.port} …`);
  try {
    const saved = await save(cfg);
    if (!saved.ok) return;
    const t = await window.settingsApi.connectTunnel();
    renderTunnel(t);
    if (t.error || t.state !== 'connected') showResult('err', `✗ VPN bağlanamadı — ${t.error || t.message}`);
    else showResult('ok', `✓ VPN açık — ${t.message}. Tüm sekmeler tünel üzerinden yükleniyor.`);
  } catch (err) {
    showResult('err', `VPN bağlanamadı: ${err.message}`);
  } finally {
    busy(false);
  }
});

$('tunnel-disconnect').addEventListener('click', async () => {
  busy(true);
  try {
    renderTunnel(await window.settingsApi.disconnectTunnel());
    showResult('ok', '✓ VPN kapatıldı. Normal proxy ayarlarına dönüldü.');
  } finally {
    busy(false);
  }
});

$('pick-key').addEventListener('click', async () => {
  const file = await window.settingsApi.pickKey();
  if (file) $('t-identityFile').value = file;
});

window.settingsApi.onTunnelStatus(renderTunnel);
$('cancel').addEventListener('click', () => window.settingsApi.close());
$('open-data').addEventListener('click', () => window.settingsApi.openDataDir());
document.addEventListener('keydown', (e) => e.key === 'Escape' && window.settingsApi.close());

window.settingsApi.get().then((data) => {
  if (!data) return showResult('err', 'Ayarlar yüklenemedi.');
  $('config-path').textContent = data.configFile;
  $('profile-path').textContent = data.profileDir;
  fillForm(configToForm(data.config));
  renderTunnel(data.tunnel);
});
