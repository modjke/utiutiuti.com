// Candle altars: tracks lit candles per altar in memory and broadcasts changes over websocket.
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const SLOTS = Number(process.env.SLOTS) || 50;
const CANDLE_MS = Number(process.env.CANDLE_MS) || 5 * 60 * 1000;
const HOLD_MS = Number(process.env.HOLD_MS) || 5000;
const HOLD_GRACE_MS = 300;            // client timers / network jitter
const MAX_MSG_PER_SEC = 10;
const ALTARS = ['resurrected', 'ban'];

// altar -> Map(slot -> candle)
const altars = Object.fromEntries(ALTARS.map(a => [a, new Map()]));

function snapshot() {
  const out = {};
  for (const a of ALTARS) out[a] = [...altars[a].values()];
  return out;
}

function nextFreeAt(altar) {
  let min = Infinity;
  for (const c of altars[altar].values()) min = Math.min(min, c.expiresAt);
  return min;
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(data);
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function light(altar) {
  const lit = altars[altar];
  if (lit.size >= SLOTS) return null;
  const free = [];
  for (let i = 0; i < SLOTS; i++) if (!lit.has(i)) free.push(i);
  const slot = free[Math.floor(Math.random() * free.length)];
  const now = Date.now();
  const candle = { slot, litAt: now, expiresAt: now + CANDLE_MS };
  lit.set(slot, candle);
  setTimeout(() => {
    if (lit.get(slot) === candle) {
      lit.delete(slot);
      broadcast({ type: 'out', altar, slot });
    }
  }, CANDLE_MS);
  return candle;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
  res.writeHead(404); res.end();
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });

wss.on('connection', ws => {
  ws.alive = true;
  ws.holds = {};                        // altar -> hold start time
  ws.window = { start: Date.now(), count: 0 };

  ws.on('pong', () => { ws.alive = true; });

  ws.on('message', raw => {
    const now = Date.now();
    if (now - ws.window.start > 1000) ws.window = { start: now, count: 0 };
    if (++ws.window.count > MAX_MSG_PER_SEC) return;

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || !ALTARS.includes(msg.altar)) return;
    const { altar } = msg;

    if (msg.type === 'hold') {
      ws.holds[altar] = now;
    } else if (msg.type === 'cancel') {
      delete ws.holds[altar];
    } else if (msg.type === 'light') {
      const started = ws.holds[altar];
      delete ws.holds[altar];
      if (!started || now - started < HOLD_MS - HOLD_GRACE_MS) {
        send(ws, { type: 'rejected', altar, reason: 'hold' });
        return;
      }
      const candle = light(altar);
      if (candle) broadcast({ type: 'lit', altar, candle, now });
      else send(ws, { type: 'full', altar, nextFreeAt: nextFreeAt(altar), now });
    }
  });

  send(ws, { type: 'state', now: Date.now(), slots: SLOTS, candleMs: CANDLE_MS, holdMs: HOLD_MS, altars: snapshot() });
});

// drop dead sockets
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 30000);

// node is PID 1 in the container and would ignore these otherwise
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));

server.listen(PORT, () => console.log(`altars listening on :${PORT} (slots=${SLOTS}, candle=${CANDLE_MS}ms, hold=${HOLD_MS}ms)`));
