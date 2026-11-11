'use strict';
const { DEFAULT_PORTS, TYPE_HINTS, formToConfig, configToForm, quickValidate } = window.SettingsForm;
const $ = (id) => document.getElementById(id);
const form = $('form');
const FIELDS = ['host', 'port', 'bypass', 'homepage'];

function readForm() {
  return {
    mode: form.querySelector('input[name=mode]:checked')?.value || 'system',
    type: $('type').value,
    host: $('host').value,
    port: $('port').value,
    bypass: $('bypass').value,
    homepage: $('homepage').value,
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
  if (first) $(first).focus();
}

function showResult(kind, text) {
  const el = $('result');
  el.className = `result ${kind}`;
  el.textContent = text;
}

function fieldFromServer(field) {
  // "proxy.host" -> "host"
  const f = String(field || '').replace(/^proxy\./, '');
  return FIELDS.includes(f) ? f : null;
}

function busy(on) {
  for (const id of ['test', 'save']) $(id).disabled = on;
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
    const r = await window.settingsApi.save(cfg);
    if (r.ok) {
      fillForm(configToForm(r.config));
      showResult('ok', '✓ Kaydedildi ve uygulandı. Sayfa yeniden yükleniyor.');
    } else {
      const f = fieldFromServer(r.error.field);
      if (f) showErrors({ [f]: r.error.message });
      showResult('err', `Kaydedilemedi: ${r.error.message}`);
    }
  } catch (err) {
    showResult('err', `Kaydedilemedi: ${err.message}`);
  } finally {
    busy(false);
  }
});

$('cancel').addEventListener('click', () => window.settingsApi.close());
$('open-data').addEventListener('click', () => window.settingsApi.openDataDir());
document.addEventListener('keydown', (e) => e.key === 'Escape' && window.settingsApi.close());

window.settingsApi.get().then((data) => {
  if (!data) return showResult('err', 'Ayarlar yüklenemedi.');
  $('config-path').textContent = data.configFile;
  $('profile-path').textContent = data.profileDir;
  fillForm(configToForm(data.config));
});
