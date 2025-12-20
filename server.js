const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Store active rooms and users
const rooms = new Map();
const users = new Map();

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);
    
    socket.on('join', (data) => {
        const { mode, interests, name, gender } = data;
        users.set(socket.id, { ...data, socketId: socket.id });
        
        // Find or create room
        let room = findMatchingRoom(mode, interests);
        if (!room) {
            room = createRoom(mode, interests);
        }
        
        socket.join(room.id);
        room.participants.push(socket.id);
        
        // Notify others in room
        socket.to(room.id).emit('user_joined', {
            user: { id: socket.id, name, interests, gender }
        });
        
        // Send room info to joining user
        const otherParticipants = room.participants.filter(id => id !== socket.id);
        socket.emit('room_info', {
            roomId: room.id,
            participants: otherParticipants.map(id => users.get(id)),
            initiator: otherParticipants.length > 0
        });
    });
    
    socket.on('offer', (data) => {
        socket.to(data.room).emit('offer', data);
    });
    
    socket.on('answer', (data) => {
        socket.to(data.room).emit('answer', data);
    });
    
    socket.on('ice_candidate', (data) => {
        socket.to(data.room).emit('ice_candidate', data);
    });
    
    socket.on('message', (data) => {
        socket.to(data.room).emit('message', {
            ...data,
            sender: socket.id
        });
    });
    
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            // Remove from rooms
            rooms.forEach((room, roomId) => {
                if (room.participants.includes(socket.id)) {
                    room.participants = room.participants.filter(id => id !== socket.id);
                    socket.to(roomId).emit('user_left', { userId: socket.id });
                    
                    if (room.participants.length === 0) {
                        rooms.delete(roomId);
                    }
                }
            });
            users.delete(socket.id);
        }
        console.log('User disconnected:', socket.id);
    });
});

function findMatchingRoom(mode, interests) {
    for (const [id, room] of rooms) {
        if (room.mode === mode && room.participants.length < (mode === 'group' ? 8 : 2)) {
            // Simple interest matching
            const hasCommonInterests = interests.some(interest => 
                room.interests.some(roomInterest => 
                    roomInterest.toLowerCase().includes(interest.toLowerCase()) ||
                    interest.toLowerCase().includes(roomInterest.toLowerCase())
                )
            );
            
            if (hasCommonInterests || room.interests.length === 0) {
                return room;
            }
        }
    }
    return null;
}

function createRoom(mode, interests) {
    const roomId = generateRoomId();
    const room = {
        id: roomId,
        mode,
        interests: interests || [],
        participants: [],
        createdAt: Date.now()
    };
    rooms.set(roomId, room);
    return room;
}

function generateRoomId() {
    return Math.random().toString(36).substring(2, 15);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
