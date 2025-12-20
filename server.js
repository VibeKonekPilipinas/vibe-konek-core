
// server/server.js
// Matchmaking + PeerJS signaling in one process
// Run: node server.js
// Env: PORT=9000, PEER_PATH=/peerjs, CORS_ORIGIN=http://localhost:5173

import express from 'express';
import cors from 'cors';
import { PeerServer } from 'peer';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 9000;
const PEER_PATH = process.env.PEER_PATH || '/peerjs';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.use(express.json());
app.use(cors({ origin: CORS_ORIGIN }));

// In-memory matchmaking
let waitingQueue = []; // {peerId, mode, interests, gender, ts}
const matches = new Map(); // peerId -> { partnerId, initiator }

// Basic interest matching (very simple demo)
function isCompatible(a, b) {
  if (a.mode !== b.mode) return false;
  // If interests provided, require one overlap (case-insensitive tags)
  if (a.interests?.length && b.interests?.length) {
    const A = new Set(a.interests.map(s => s.toLowerCase()));
    return b.interests.some(s => A.has(s.toLowerCase()));
  }
  return true;
}

// Enqueue endpoint: tries to match immediately, else queues
app.post('/api/queue', (req, res) => {
  const { peerId, mode = 'text', interests = [], gender = 'any' } = req.body || {};
  if (!peerId) return res.status(400).json({ error: 'peerId required' });

  const me = { peerId, mode, interests, gender, ts: Date.now() };

  // Try to match with someone compatible
  const idx = waitingQueue.findIndex(p => p.peerId !== peerId && isCompatible(me, p));
  if (idx !== -1) {
    const other = waitingQueue.splice(idx, 1)[0];
    // Decide initiator deterministically (newcomer initiates)
    matches.set(me.peerId, { partnerId: other.peerId, initiator: true });
    matches.set(other.peerId, { partnerId: me.peerId, initiator: false });
    return res.json({ status: 'matched', partnerId: other.peerId, initiator: true });
  }

  // Otherwise enqueue
  waitingQueue.push(me);
  return res.json({ status: 'waiting' });
});

// Poll to check if matched
app.get('/api/match', (req, res) => {
  const { peerId } = req.query;
  const m = matches.get(peerId);
  if (!m) return res.json({ status: 'waiting' });
  matches.delete(peerId); // one-time read
  res.json({ status: 'matched', ...m });
});

// Stats for UI
app.get('/api/stats', (_req, res) => {
  res.json({
    online: peerServer?._clients?.get('peerjs')?.size || 0,
    waiting: waitingQueue.length,
  });
});

// Clean up queue (stale > 2 minutes)
setInterval(() => {
  const now = Date.now();
  waitingQueue = waitingQueue.filter(p => now - p.ts < 2 * 60 * 1000);
}, 10 * 1000);

// PeerServer (signaling) on same HTTP server
const peerServer = PeerServer({
  port: PORT,
  path: PEER_PATH,
  // Note: data/media do NOT proxy via this server; it's signaling only. 
  // See docs. 
}, () => {
  console.log(`PeerServer listening on :${PORT}${PEER_PATH}`);
});

// Mount Express on the same port via a lightweight proxy
// When PeerServer returns an http.Server, we can attach Express to another port.
// For simplicity in single-process deployment, run Express separately.
const api = app.listen(PORT + 1, () => {
  console.log(`API listening at http://localhost:${PORT + 1}`);
});
