
// app.js
const API_BASE = 'http://localhost:9001'; // Express API (PORT+1)
const PEER_HOST = 'localhost';
const PEER_PORT = 9000;
const PEER_PATH = '/peerjs';

let peer = null;
let conn = null;
let call = null;
let aesKey = null; // E2EE content key
let myKeys = null;

const els = {
  statOnline: document.getElementById('statOnline'),
  statWaiting: document.getElementById('statWaiting'),
  btnTheme: document.getElementById('btnTheme'),
  displayName: document.getElementById('displayName'),
  mode: document.getElementById('mode'),
  interests: document.getElementById('interests'),
  gender: document.getElementById('gender'),
  btnStart: document.getElementById('btnStart'),
  btnEnd: document.getElementById('btnEnd'),
  status: document.getElementById('status'),
  messages: document.getElementById('messages'),
  sendForm: document.getElementById('sendForm'),
  msgInput: document.getElementById('messageInput'),
  btnSend: document.getElementById('btnSend'),
  btnReport: document.getElementById('btnReport'),
  localVideo: document.getElementById('localVideo'),
  remoteVideo: document.getElementById('remoteVideo'),
};

function setStatus(s) { els.status.textContent = s; }

async function refreshStats() {
  try {
    const r = await fetch(`${API_BASE}/api/stats`);
    const j = await r.json();
    els.statOnline.textContent = `Online: ${j.online}`;
    els.statWaiting.textContent = `Waiting: ${j.waiting}`;
  } catch (e) { /* ignore */ }
}
setInterval(refreshStats, 3000);
refreshStats();

els.btnTheme.addEventListener('click', () => document.body.classList.toggle('light'));

els.sendForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = els.msgInput.value.trim();
  if (!text || !conn || conn.open !== true || !aesKey) return;
  const payload = await E2EE.encrypt(aesKey, JSON.stringify({ author: els.displayName.value || 'Anonymous', text }));
  conn.send({ type: 'msg', payload });
  addMessage({ me: true, text });
  els.msgInput.value = '';
});

els.btnReport.addEventListener('click', () => {
  alert('Thanks for reporting. (Demo) In production, send to /api/report with context.');
});

els.btnStart.addEventListener('click', startConnection);
els.btnEnd.addEventListener('click', endConnection);

async function startConnection(e) {
  e.preventDefault();

  // Set up PeerJS
  peer = new Peer(undefined, {
    host: PEER_HOST, port: PEER_PORT, path: PEER_PATH,
    // ICE servers: STUN for NAT traversal; add TURN for hard NATs.
    config: { iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:3478' }
    ] }
  });
  setStatus('Creating peer…');

  peer.on('open', async (id) => {
    setStatus(`Peer ready (${id}). Finding match…`);
    els.btnEnd.disabled = false;

    // Generate session keys for content E2EE
    myKeys = await E2EE.generateKeyPair();
    const pub = await E2EE.exportPub(myKeys);

    // Enqueue on matchmaking API
    const interests = (els.interests.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const body = { peerId: id, mode: els.mode.value, interests, gender: els.gender.value };
    const r = await fetch(`${API_BASE}/api/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();

    if (j.status === 'matched') {
      await handleMatch(j.partnerId, j.initiator, pub);
    } else {
      setStatus('Waiting for a compatible partner…');
      pollForMatch(id, pub);
    }
  });

  peer.on('connection', async (incoming) => {
    conn = incoming;
    wireDataConnection();
  });

  peer.on('call', async (incomingCall) => {
    // Answer with local media stream if mode === video
    if (els.mode.value !== 'video') return;
    const local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    els.localVideo.srcObject = local;
    incomingCall.answer(local);
    incomingCall.on('stream', (remoteStream) => { els.remoteVideo.srcObject = remoteStream; });
    call = incomingCall;
  });

  peer.on('error', (err) => setStatus(`Peer error: ${err?.type || err}`));
}

async function pollForMatch(peerId, pub) {
  const iv = setInterval(async () => {
    const r = await fetch(`${API_BASE}/api/match?peerId=${encodeURIComponent(peerId)}`);
    const j = await r.json();
    if (j.status === 'matched') {
      clearInterval(iv);
      await handleMatch(j.partnerId, j.initiator, pub);
    }
  }, 1500);
}

async function handleMatch(partnerId, initiator, myPubJwk) {
  setStatus(`Matched! ${initiator ? 'Initiating' : 'Awaiting'} connection…`);

  if (initiator) {
    // Create data connection and perform E2EE key exchange
    conn = peer.connect(partnerId, { reliable: true });
    wireDataConnection(() => {
      conn.send({ type: 'pubkey', jwk: myPubJwk });
    });
  }

  // For video mode, start the outbound call if initiator
  if (els.mode.value === 'video' && initiator) {
    const local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    els.localVideo.srcObject = local;
    call = peer.call(partnerId, local);
    call.on('stream', (remoteStream) => { els.remoteVideo.srcObject = remoteStream; });
  }
}

function wireDataConnection(onOpenSend) {
  conn.on('open', () => {
    els.btnSend.disabled = false;
    setStatus('Connected. Say hi!');
    if (onOpenSend) onOpenSend();
  });

  conn.on('data', async (msg) => {
    if (msg?.type === 'pubkey') {
      // Received peer public key -> derive shared AES-GCM key and send ours back if we haven't
      const peerPub = await E2EE.importPub(msg.jwk);
      aesKey = await E2EE.deriveAesGcmKey(myKeys.privateKey, peerPub);
      // Send our pubkey if we didn't already (when we are the passive side)
      if (!msg.echo && myKeys) {
        const myPub = await E2EE.exportPub(myKeys);
        conn.send({ type: 'pubkey', jwk: myPub, echo: true });
      }
      return;
    }
    if (msg?.type === 'msg' && aesKey) {
      const body = await E2EE.decrypt(aesKey, msg.payload);
      const { author, text } = JSON.parse(body);
      addMessage({ me: false, text, author });
    }
  });

  conn.on('close', () => endConnection());
  conn.on('error', (e) => setStatus(`Conn error: ${e?.type || e}`));
}

function addMessage({ me, text, author }) {
  const li = document.createElement('li');
  if (me) li.classList.add('me');
  li.textContent = me ? text : `${author ?? 'Partner'}: ${text}`;
  els.messages.appendChild(li);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function endConnection() {
  els.btnSend.disabled = true;
  els.btnEnd.disabled = true;
  setStatus('Chat ended.');

  if (conn && conn.open) conn.close();
  conn = null;

  if (call) try { call.close(); } catch {}
  call = null;

  // Stop local media
  const s = els.localVideo.srcObject; 
  if (s) { s.getTracks().forEach(t => t.stop()); els.localVideo.srcObject = null; }
  els.remoteVideo.srcObject = null;

  if (peer) { try { peer.destroy(); } catch {} }
  peer = null;

  aesKey = null; myKeys = null;
}
