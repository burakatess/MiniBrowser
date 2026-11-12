'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../../src/main/tab-model');

test('etkin sekme kapanınca sağdaki, yoksa soldaki seçilir', () => {
  assert.equal(m.nextActiveAfterClose([1, 2, 3], 2, 2), 3);
  assert.equal(m.nextActiveAfterClose([1, 2, 3], 3, 3), 2);
  assert.equal(m.nextActiveAfterClose([1, 2, 3], 1, 1), 2);
  assert.equal(m.nextActiveAfterClose([1], 1, 1), null);
});

test('etkin olmayan sekme kapanınca etkin sekme değişmez', () => {
  assert.equal(m.nextActiveAfterClose([1, 2, 3], 1, 3), 3);
  assert.equal(m.nextActiveAfterClose([1, 2, 3], 9, 3), 3);
});

test('Ctrl+Tab döngüsü', () => {
  assert.equal(m.cycle([1, 2, 3], 3, 1), 1);
  assert.equal(m.cycle([1, 2, 3], 1, -1), 3);
  assert.equal(m.cycle([1, 2, 3], 2, 1), 3);
  assert.equal(m.cycle([], null, 1), null);
});

test('Ctrl+1..8 ve Ctrl+9', () => {
  assert.equal(m.byShortcutNumber([5, 6, 7], 1), 5);
  assert.equal(m.byShortcutNumber([5, 6, 7], 9), 7);
  assert.equal(m.byShortcutNumber([5, 6, 7], 4), null);
  assert.equal(m.byShortcutNumber([5, 6, 7], 0), null);
});

test('bağlantıdan açılan sekme açanın sağına, diğerleri sona eklenir', () => {
  assert.equal(m.insertIndex([1, 2, 3], 1), 1);
  assert.equal(m.insertIndex([1, 2, 3], null), 3);
  assert.equal(m.insertIndex([1, 2, 3], 99), 3);
});

test('klavye kısayolları (Windows/Linux: Ctrl)', () => {
  const k = (key, mods = {}) => m.shortcutAction({ type: 'keyDown', key, control: false, meta: false, shift: false, alt: false, ...mods }, 'win32');
  assert.deepEqual(k('t', { control: true }), { type: 'new' });
  assert.deepEqual(k('T', { control: true, shift: true }), { type: 'reopen' });
  assert.deepEqual(k('w', { control: true }), { type: 'close' });
  assert.deepEqual(k('Tab', { control: true }), { type: 'cycle', dir: 1 });
  assert.deepEqual(k('Tab', { control: true, shift: true }), { type: 'cycle', dir: -1 });
  assert.deepEqual(k('3', { control: true }), { type: 'select', n: 3 });
  assert.deepEqual(k('l', { control: true }), { type: 'focus-address' });
  assert.deepEqual(k('F5'), { type: 'reload' });
  assert.deepEqual(k('ArrowLeft', { alt: true }), { type: 'back' });
  assert.equal(k('t'), null, 'değiştirici tuş yoksa yazı yazmayı engelleme');
  assert.equal(k('t', { meta: true }), null, "Windows'ta Win+T kısayol değil");
  assert.equal(m.shortcutAction({ type: 'keyUp', key: 't', control: true }, 'win32'), null);
});

test('macOS: Cmd kısayolları', () => {
  assert.deepEqual(m.shortcutAction({ type: 'keyDown', key: 't', meta: true, control: false }, 'darwin'), { type: 'new' });
});
