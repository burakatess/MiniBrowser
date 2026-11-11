'use strict';
const $ = (id) => document.getElementById(id);
window.authApi.info().then((i) => {
  $('heading').textContent = i.isProxy ? 'Proxy kimlik doğrulaması' : 'Site kimlik doğrulaması';
  $('desc').textContent = `${i.host}${i.realm ? ` — ${i.realm}` : ''}`;
  $('user').focus();
});
$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  window.authApi.submit($('user').value, $('pass').value);
});
$('cancel').addEventListener('click', () => window.authApi.cancel());
document.addEventListener('keydown', (e) => e.key === 'Escape' && window.authApi.cancel());
