'use strict';
/** Sekme sırası ve etkin sekme seçimi için saf yardımcılar (Electron'suz test edilir). */

const MAX_TABS = 50;

/** Kapatılan sekmeden sonra hangi sekmenin etkin olacağı (Chrome gibi: sağdaki, yoksa soldaki). */
function nextActiveAfterClose(ids, closedId, activeId) {
  const idx = ids.indexOf(closedId);
  if (idx === -1) return activeId;
  const remaining = ids.filter((id) => id !== closedId);
  if (remaining.length === 0) return null;
  if (closedId !== activeId) return activeId;
  return remaining[Math.min(idx, remaining.length - 1)];
}

/** Ctrl+Tab / Ctrl+Shift+Tab: döngüsel sonraki/önceki sekme. */
function cycle(ids, activeId, dir) {
  if (ids.length === 0) return null;
  const idx = ids.indexOf(activeId);
  if (idx === -1) return ids[0];
  return ids[(idx + dir + ids.length) % ids.length];
}

/** Ctrl+1..8 n. sekme, Ctrl+9 son sekme. */
function byShortcutNumber(ids, n) {
  if (ids.length === 0 || n < 1 || n > 9) return null;
  if (n === 9) return ids[ids.length - 1];
  return ids[n - 1] ?? null;
}

/** Yeni sekmenin ekleneceği konum: etkin sekmenin hemen sağı (bağlantıdan açılınca) veya sona. */
function insertIndex(ids, openerId) {
  const idx = openerId == null ? -1 : ids.indexOf(openerId);
  return idx === -1 ? ids.length : idx + 1;
}

/** Klavye kısayolunu sekme eylemine çevirir. input: Electron before-input-event 'input' nesnesi. */
function shortcutAction(input, platform = process.platform) {
  if (input.type !== 'keyDown') return null;
  const mod = platform === 'darwin' ? input.meta : input.control;
  const key = String(input.key || '');
  if (input.control && key === 'Tab') return { type: 'cycle', dir: input.shift ? -1 : 1 };
  if (!mod) {
    if (key === 'F5') return { type: 'reload' };
    if (input.alt && key === 'ArrowLeft') return { type: 'back' };
    if (input.alt && key === 'ArrowRight') return { type: 'forward' };
    return null;
  }
  const k = key.toLowerCase();
  if (k === 't' && !input.shift) return { type: 'new' };
  if (k === 't' && input.shift) return { type: 'reopen' };
  if (k === 'w' || key === 'F4') return { type: 'close' };
  if (k === 'l') return { type: 'focus-address' };
  if (k === 'r') return { type: 'reload' };
  if (/^[1-9]$/.test(key)) return { type: 'select', n: Number(key) };
  if (key === 'PageDown') return { type: 'cycle', dir: 1 };
  if (key === 'PageUp') return { type: 'cycle', dir: -1 };
  return null;
}

module.exports = { MAX_TABS, nextActiveAfterClose, cycle, byShortcutNumber, insertIndex, shortcutAction };
