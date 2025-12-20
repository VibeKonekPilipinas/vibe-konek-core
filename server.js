const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let users = new Map();
let waitingQueue = [];

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);
    
    socket.on('register', (userData) => {
        users.set(socket.id, {
            ...userData,
            socketId: socket.id,
            connectedAt: Date.now(),
            status: 'online'
        });
        
        io.emit('onlineCount', users.size);
    });
    
    socket.on('findMatch', (userData) => {
        const user = { ...userData, socketId: socket.id };
        waitingQueue.push(user);
        
        // Try to match
        matchUsers();
        
        socket.emit('queueUpdate', waitingQueue.length);
    });
    
    socket.on('message', (data) => {
        const sender = users.get(socket.id);
        const partner = Array.from(users.values()).find(u => u.userId === data.to);
        
        if (partner && partner.socketId) {
            io.to(partner.socketId).emit('message', {
                ...data,
                timestamp: Date.now()
            });
        }
    });
    
    socket.on('file', (data) => {
        const sender = users.get(socket.id);
        const partner = Array.from(users.values()).find(u => u.userId === data.to);
        
        if (partner && partner.socketId) {
            io.to(partner.socketId).emit('file', {
                ...data,
                timestamp: Date.now()
            });
        }
    });
    
    socket.on('skipPartner', (data) => {
        const user = users.get(socket.id);
        if (user && user.partnerId) {
            const partner = users.get(user.partnerId);
            if (partner) {
                io.to(partner.socketId).emit('partnerDisconnected');
                delete partner.partnerId;
                delete user.partnerId;
            }
        }
    });
    
    socket.on('ping', () => {
        socket.emit('pong');
    });
    
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            if (user.partnerId) {
                const partner = users.get(user.partnerId);
                if (partner) {
                    io.to(partner.socketId).emit('partnerDisconnected');
                    delete partner.partnerId;
                }
            }
            users.delete(socket.id);
        }
        
        waitingQueue = waitingQueue.filter(u => u.socketId !== socket.id);
        io.emit('onlineCount', users.size);
    });
});

function matchUsers() {
    while (waitingQueue.length >= 2) {
        const user1 = waitingQueue.shift();
        const user2 = waitingQueue.shift();
        
        const socket1 = io.sockets.sockets.get(user1.socketId);
        const socket2 = io.sockets.sockets.get(user2.socketId);
        
        if (socket1 && socket2) {
            // Set partners
            users.get(user1.socketId).partnerId = user2.socketId;
            users.get(user2.socketId).partnerId = user1.socketId;
            
            // Emit match found
            socket1.emit('matchFound', {
                userId: user2.userId,
                name: user2.name,
                gender: user2.gender,
                interests: user2.interests
            });
            
            socket2.emit('matchFound', {
                userId: user1.userId,
                name: user1.name,
                gender: user1.gender,
                interests: user1.interests
            });
        }
    }
    
    // Update remaining queue
    waitingQueue.forEach((user, index) => {
        const socket = io.sockets.sockets.get(user.socketId);
        if (socket) {
            socket.emit('queueUpdate', index + 1);
        }
    });
}

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        users: users.size,
        queue: waitingQueue.length 
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
