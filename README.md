// This is optional - only needed if you want to host your own PeerJS server
// Install: npm install peer
// Run: node server.js

const { PeerServer } = require('peer');

const peerServer = PeerServer({
    port: 9000,
    path: '/peerjs',
    allow_discovery: true,
    proxied: true,
    ssl: false // Set to true if using HTTPS
});

console.log('PeerJS server running on port 9000');

peerServer.on('connection', (client) => {
    console.log('Client connected:', client.getId());
});

peerServer.on('disconnect', (client) => {
    console.log('Client disconnected:', client.getId());
});
