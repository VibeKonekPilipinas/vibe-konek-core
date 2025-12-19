/* =========================================
   1. CONFIGURATION & STATE
   ========================================= */
// REPLACE THIS with your actual Server URL (e.g., from Glitch/Render)
const SIGNALING_SERVER_URL = 'https://your-vibe-konek-server.glitch.me'; 

// Public STUN servers (Google's free ones) for NAT traversal
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Global State
let socket;
let localStream;
let peerConnection;
let remoteSocketId;
let isInitiator = false;
let setupFormData = { type: 'chat', interests: [], gender: 'any' };

// Tailwind Config (Keep this for styling)
tailwind.config = {
    theme: {
        extend: {
            colors: { 'vibe-yellow': '#FACC15', 'vibe-black': '#030408', 'vibe-cyan': '#22D3EE', 'vibe-pink': '#F472B6' },
            fontFamily: { sans: ['Inter', 'sans-serif'], display: ['Bricolage Grotesque', 'sans-serif'] },
            animation: { 'radar': 'radar-spin 2s linear infinite' },
            keyframes: { 'radar-spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } } }
        }
    }
};

/* =========================================
   2. DOM ELEMENTS
   ========================================= */
const connectingOverlay = document.getElementById('connectingOverlay');
const modalOverlay = document.getElementById('modalOverlay');
const modalBox = document.querySelector('.modal-box');
const technicalLog = document.getElementById('technicalLog');
const loadingStatusText = document.getElementById('loadingStatusText');
// Add a video container to your HTML if using video/audio
// <video id="localVideo" muted autoplay></video>
// <video id="remoteVideo" autoplay></video>

/* =========================================
   3. REAL BACKEND CONNECTION LOGIC
   ========================================= */

async function startConnectionProcess() {
    closeModal();
    
    // 1. Show Loading UI
    connectingOverlay.classList.remove('opacity-0', 'pointer-events-none');
    connectingOverlay.classList.add('opacity-100', 'pointer-events-auto');
    updateStatusLog("Initializing Hardware Layer...");

    try {
        // 2. Get User Media (Real Camera/Mic) if needed
        if (setupFormData.type === 'video' || setupFormData.type === 'audio') {
            const constraints = {
                video: setupFormData.type === 'video',
                audio: true
            };
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
            // If you have a local video element, set it here:
            // document.getElementById('localVideo').srcObject = localStream;
            updateStatusLog("Media Stream Active. Connecting to Socket...");
        }

        // 3. Connect to Signaling Server
        if (!socket) {
            socket = io(SIGNALING_SERVER_URL);
            initializeSocketListeners();
        } else {
            // Re-use socket but ensure we are clean
            socket.connect();
            socket.emit('find_match', setupFormData);
        }

    } catch (err) {
        console.error("Hardware/Connection Error:", err);
        updateStatusLog("Error: Could not access Camera/Mic or Server.");
        alert("Please allow Camera/Mic access to continue.");
        cancelConnection();
    }
}

function initializeSocketListeners() {
    socket.on('connect', () => {
        updateStatusLog("Connected to Node. Handshaking...");
        socket.emit('find_match', setupFormData);
    });

    socket.on('waiting_in_queue', () => {
        updateStatusLog("Searching for Peer...");
        loadingStatusText.innerText = "SCANNING NETWORK";
    });

    socket.on('match_found', (data) => {
        updateStatusLog(`Match Found! Connecting to ${data.peerId}...`);
        isInitiator = data.initiator;
        remoteSocketId = data.peerId;
        
        // Start WebRTC Signaling
        initializePeerConnection();
    });

    // Handle WebRTC Signals (Offer, Answer, ICE Candidates)
    socket.on('signal', async (data) => {
        if (!peerConnection) return;

        if (data.type === 'offer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('signal', { target: remoteSocketId, type: 'answer', sdp: answer });
        } 
        else if (data.type === 'answer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        } 
        else if (data.type === 'candidate') {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    });

    socket.on('peer_disconnected', () => {
        alert("Peer Disconnected. Searching for new match...");
        resetPeerConnection();
        socket.emit('find_match', setupFormData);
    });
}

/* =========================================
   4. WEBRTC (PEER-TO-PEER) LOGIC
   ========================================= */

function initializePeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);

    // Add local tracks to connection
    if (localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }

    // Handle Remote Stream (When friend's video arrives)
    peerConnection.ontrack = (event) => {
        // Here is where you attach the "Stranger's" video to your HTML
        // const remoteVideo = document.getElementById('remoteVideo');
        // if (remoteVideo) remoteVideo.srcObject = event.streams[0];
        
        // HIDE OVERLAY WHEN CONNECTED
        connectingOverlay.classList.remove('opacity-100', 'pointer-events-auto');
        connectingOverlay.classList.add('opacity-0', 'pointer-events-none');
        console.log("Active Connection Established!");
    };

    // Handle ICE Candidates (Network Paths)
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { target: remoteSocketId, type: 'candidate', candidate: event.candidate });
        }
    };

    // If we are the "Initiator" (Player 1), we create the Offer
    if (isInitiator) {
        createOffer();
    }
}

async function createOffer() {
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('signal', { target: remoteSocketId, type: 'offer', sdp: offer });
    } catch (err) {
        console.error("Error creating offer:", err);
    }
}

function resetPeerConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    // Show overlay again to indicate searching
    connectingOverlay.classList.remove('opacity-0', 'pointer-events-none');
    connectingOverlay.classList.add('opacity-100', 'pointer-events-auto');
    loadingStatusText.innerText = "RE-INDEXING";
}

/* =========================================
   5. UI HELPERS (MODALS, ETC)
   ========================================= */

function cancelConnection() {
    if (socket) socket.disconnect();
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    resetPeerConnection();
    
    connectingOverlay.classList.remove('opacity-100', 'pointer-events-auto');
    connectingOverlay.classList.add('opacity-0', 'pointer-events-none');
    document.body.classList.remove('no-scroll');
}

function updateStatusLog(text) {
    technicalLog.style.opacity = '0';
    setTimeout(() => {
        technicalLog.innerText = text;
        technicalLog.style.opacity = '1';
    }, 200);
}

// Modal Logic
function openSetup(type) {
    setupFormData.type = type;
    modalBox.querySelector('.modal-title').innerText = type === 'video' ? 'Video Sync' : 'Text Node';
    modalOverlay.classList.remove('opacity-0', 'pointer-events-none');
    modalBox.classList.remove('scale-90', 'translate-y-10');
    modalBox.classList.add('scale-100', 'translate-y-0');
}

function closeModal() {
    modalOverlay.classList.add('opacity-0', 'pointer-events-none');
    modalBox.classList.add('scale-90', 'translate-y-10');
    modalBox.classList.remove('scale-100', 'translate-y-0');
}

// Listeners
window.addEventListener('scroll', () => {
    const header = document.getElementById('mainHeader');
    if(window.scrollY > 50) header.classList.add('opacity-0');
    else header.classList.remove('opacity-0');
});
