'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const p = require('../../src/main/paths');

test('--data-dir argümanı (iki biçim, sonuncusu geçerli)', () => {
  assert.equal(p.parseDataDirArg(['--data-dir=/a']), '/a');
  assert.equal(p.parseDataDirArg(['--data-dir', '/b']), '/b');
  assert.equal(p.parseDataDirArg(['--data-dir=/a', '--data-dir=/c']), '/c');
  assert.equal(p.parseDataDirArg(['--data-dir="/q"']), '/q');
  assert.equal(p.parseDataDirArg(['--data-dir=']), null);
  assert.equal(p.parseDataDirArg([]), null);
});

test('veri dizini öncelik sırası', () => {
  const base = { execPath: '/apps/mb/MiniBrowser.exe', appRoot: '/src/mb', cwd: '/cwd' };
  assert.equal(p.resolveDataDir({ ...base, argv: ['--data-dir=rel'], env: { PORTABLE_EXECUTABLE_DIR: '/usb' }, isPackaged: true }), path.resolve('/cwd', 'rel'));
  assert.equal(p.resolveDataDir({ ...base, argv: [], env: { PORTABLE_EXECUTABLE_DIR: '/usb' }, isPackaged: true }), path.join('/usb', 'MiniBrowserData'));
  assert.equal(p.resolveDataDir({ ...base, argv: [], env: {}, isPackaged: true }), path.join('/apps/mb', 'MiniBrowserData'));
  assert.equal(p.resolveDataDir({ ...base, argv: [], env: {}, isPackaged: false }), path.join('/src/mb', 'MiniBrowserData'));
});

test('profil, yapılandırma ve loglar veri klasörünün içinde', () => {
  const b = p.buildPaths('/d');
  for (const k of ['configFile', 'profileDir', 'logsDir', 'crashDir']) assert.ok(b[k].startsWith('/d'), k);
});

test('ensureWritableDirs klasörleri oluşturur', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mb-p-')), 'data');
  const b = p.buildPaths(dir);
  p.ensureWritableDirs(b);
  assert.ok(fs.statSync(b.profileDir).isDirectory());
  assert.deepEqual(fs.readdirSync(dir).sort(), ['crashes', 'logs', 'profile']);
});

test('yazılamayan klasör için anlaşılır hata', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-ro-'));
  fs.chmodSync(parent, 0o500);
  try {
    assert.throws(() => p.ensureWritableDirs(p.buildPaths(path.join(parent, 'data'))), /oluşturulamadı|yazılamıyor/);
  } finally {
    fs.chmodSync(parent, 0o700);
  }
});
