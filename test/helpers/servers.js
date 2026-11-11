'use strict';
/** E2E testleri için yerel hedef sunucu, HTTP proxy ve SOCKS5 proxy. */
const http = require('node:http');
const net = require('node:net');

const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

/** "Merhaba" sayfası döndüren hedef sunucu. */
async function startTargetServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, host: req.headers.host });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>MiniBrowser E2E</title><body>hedef-sayfa host=${req.headers.host}</body>`);
  });
  const port = await listen(server);
  return { port, requests, close: () => new Promise((r) => server.close(r)) };
}

/**
 * Basit HTTP proxy: hangi host istenirse istensin isteği hedef sunucuya iletir.
 * Böylece DNS'te olmayan bir alan adının (".test") açılabilmesi, trafiğin
 * gerçekten proxy'den geçtiğini kanıtlar.
 */
async function startHttpProxy(targetPort, { requireAuth = null } = {}) {
  const log = [];
  const server = http.createServer((req, res) => {
    log.push({ method: req.method, url: req.url, auth: req.headers['proxy-authorization'] || null });
    if (requireAuth && req.headers['proxy-authorization'] !== `Basic ${Buffer.from(requireAuth).toString('base64')}`) {
      res.writeHead(407, { 'proxy-authenticate': 'Basic realm="e2e"' });
      return res.end();
    }
    const u = new URL(req.url);
    const upstream = http.request(
      { host: '127.0.0.1', port: targetPort, path: u.pathname + u.search, method: req.method, headers: { ...req.headers, host: u.host } },
      (up) => {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
      }
    );
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
  });
  server.on('connect', (req, socket) => {
    log.push({ method: 'CONNECT', url: req.url });
    const up = net.connect(targetPort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      up.pipe(socket).pipe(up);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });
  const port = await listen(server);
  return {
    port,
    log,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections?.();
        server.close(r);
      }),
  };
}

/** Kimlik doğrulamasız SOCKS5 (RFC 1928) sunucusu; tüm hedefleri targetPort'a yönlendirir. */
async function startSocks5Proxy(targetPort) {
  const log = [];
  const sockets = new Set();
  const server = net.createServer((client) => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => {});
    let stage = 'greeting';
    let buf = Buffer.alloc(0);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 'greeting') {
        if (buf.length < 2 || buf.length < 2 + buf[1]) return;
        if (buf[0] !== 5) return client.destroy();
        buf = buf.subarray(2 + buf[1]);
        client.write(Buffer.from([5, 0])); // "kimlik doğrulama yok"
        stage = 'request';
      }
      if (stage === 'request') {
        if (buf.length < 5) return;
        const atyp = buf[3];
        let host;
        let off;
        if (atyp === 1) { if (buf.length < 10) return; host = [...buf.subarray(4, 8)].join('.'); off = 8; }
        else if (atyp === 3) { const n = buf[4]; if (buf.length < 5 + n + 2) return; host = buf.subarray(5, 5 + n).toString(); off = 5 + n; }
        else if (atyp === 4) { if (buf.length < 22) return; host = 'ipv6'; off = 20; }
        else return client.destroy();
        const port = buf.readUInt16BE(off);
        const rest = buf.subarray(off + 2);
        stage = 'piping';
        client.removeListener('data', onData);
        log.push({ host, port, atyp });
        const up = net.connect(targetPort, '127.0.0.1', () => {
          client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          if (rest.length) up.write(rest);
          up.pipe(client).pipe(up);
        });
        up.on('error', () => client.destroy());
      }
    };
    client.on('data', onData);
  });
  const port = await listen(server);
  return {
    port,
    log,
    close: () =>
      new Promise((r) => {
        for (const s of sockets) s.destroy();
        server.close(r);
      }),
  };
}

/** Kapalı (dinlemeyen) bir port bulur. */
async function findClosedPort() {
  const s = net.createServer();
  const port = await listen(s);
  await new Promise((r) => s.close(r));
  return port;
}

module.exports = { startTargetServer, startHttpProxy, startSocks5Proxy, findClosedPort };
