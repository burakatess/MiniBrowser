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
$('reload').addEventListener('click', () => (loading ? window.mini.stop() : window.mini.reload()));
$('notice-close').addEventListener('click', () => $('notice').classList.add('hidden'));

$('address-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = address.value.trim();
  if (value) window.mini.go(value);
  address.blur();
});
address.addEventListener('focus', () => address.select());

document.addEventListener('keydown', (e) => {
  if (e.key === 'F5') { e.preventDefault(); window.mini.reload(); }
  else if (e.altKey && e.key === 'ArrowLeft') window.mini.back();
  else if (e.altKey && e.key === 'ArrowRight') window.mini.forward();
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); address.focus(); }
});

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
  badge.title = `${p.label} — ayarları aç`;
  badge.classList.toggle('manual', p.mode === 'manual');
});

window.mini.onError((message) => {
  $('notice-text').textContent = message;
  $('notice').classList.remove('hidden');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => $('notice').classList.add('hidden'), 8000);
});
