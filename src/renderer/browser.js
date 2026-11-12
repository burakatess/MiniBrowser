'use strict';
const $ = (id) => document.getElementById(id);
const address = $('address');
let loading = false;
let noticeTimer = null;

$('back').addEventListener('click', () => window.mini.back());
$('forward').addEventListener('click', () => window.mini.forward());
$('home').addEventListener('click', () => window.mini.home());
$('settings').addEventListener('click', () => window.mini.openSettings());
$('proxy-badge').addEventListener('click', () => window.mini.openSettings());
$('vpn').addEventListener('click', () => window.mini.toggleTunnel());
$('new-tab').addEventListener('click', () => window.mini.newTab());
$('reload').addEventListener('click', () => (loading ? window.mini.stop() : window.mini.reload()));
$('notice-close').addEventListener('click', () => $('notice').classList.add('hidden'));

$('address-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = address.value.trim();
  if (value) window.mini.go(value);
  address.blur();
});
address.addEventListener('focus', () => address.select());
window.mini.onFocusAddress(() => {
  address.focus();
  address.select();
});

// ---- Sekme şeridi ---------------------------------------------------------
const tabsEl = $('tabs');
tabsEl.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  if (e.target.closest('.close')) window.mini.closeTab(tab.dataset.id);
  else window.mini.selectTab(tab.dataset.id);
});
tabsEl.addEventListener('auxclick', (e) => {
  const tab = e.target.closest('.tab');
  if (tab && e.button === 1) window.mini.closeTab(tab.dataset.id); // orta tık kapatır
});

function renderTabs({ tabs, activeId }) {
  const frag = document.createDocumentFragment();
  for (const t of tabs) {
    const el = document.createElement('div');
    el.className = `tab${t.id === activeId ? ' active' : ''}`;
    el.dataset.id = String(t.id);
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(t.id === activeId));
    el.title = t.url ? `${t.title}\n${t.url}` : t.title;
    if (t.loading) {
      const sp = document.createElement('span');
      sp.className = 'spinner';
      sp.setAttribute('aria-hidden', 'true');
      el.append(sp);
    }
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = t.title; // textContent: sayfa başlığı HTML olarak yorumlanmaz
    const close = document.createElement('button');
    close.className = 'close';
    close.textContent = '×';
    close.title = 'Sekmeyi kapat (Ctrl+W)';
    close.setAttribute('aria-label', `${t.title} sekmesini kapat`);
    el.append(title, close);
    frag.append(el);
  }
  tabsEl.replaceChildren(frag);
}
window.mini.onTabs(renderTabs);

// ---- Gezinme durumu -------------------------------------------------------
window.mini.onState((s) => {
  loading = s.loading;
  $('back').disabled = !s.canGoBack;
  $('forward').disabled = !s.canGoForward;
  $('reload').textContent = s.loading ? '✕' : '⟳';
  $('reload').title = s.loading ? 'Durdur' : 'Yenile (F5)';
  if (document.activeElement !== address) address.value = s.url || '';
});

window.mini.onProxyStatus((p) => {
  const badge = $('proxy-badge');
  badge.textContent = p.mode === 'manual' ? `Proxy: ${p.label}` : p.label;
  badge.title = p.overridden ? `${p.label} — VPN açıkken kullanılmıyor` : `${p.label} — ayarları aç`;
  badge.classList.toggle('manual', p.mode === 'manual');
  badge.classList.toggle('overridden', !!p.overridden);
});

const VPN_LABELS = { idle: 'VPN kapalı', connecting: 'VPN bağlanıyor…', connected: 'VPN açık', error: 'VPN hatası' };
window.mini.onTunnelStatus((t) => {
  const btn = $('vpn');
  const state = t.wanted ? t.state : 'idle';
  btn.className = `vpn ${state}`;
  btn.textContent = VPN_LABELS[state] || 'VPN';
  btn.setAttribute('aria-pressed', String(!!t.wanted));
  btn.title = !t.configured
    ? 'VPN (SSH tüneli) ayarlanmamış — ayarlamak için tıklayın'
    : t.wanted
      ? `${t.message || ''}\nKapatmak için tıklayın`
      : 'VPN (SSH tüneli) açmak için tıklayın';
});

window.mini.onError((message) => {
  $('notice-text').textContent = message;
  $('notice').classList.remove('hidden');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => $('notice').classList.add('hidden'), 10000);
});
