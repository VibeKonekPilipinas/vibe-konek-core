// Complete server.js for Render
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: [
      'https://vibekonek.netlify.app',
      'https://vibekonek.blogspot.com',
      'http://localhost:3000'
    ],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Store users and rooms
const users = new Map();
const waitingRooms = { chat: [], audio: [], video: [] };

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  users.set(socket.id, {
    id: socket.id,
    name: 'Anonymous',
    interests: [],
    room: null
  });
  
  // Find partner
  socket.on('find_partner', (data) => {
    const queue = waitingRooms[data.mode];
    const user = users.get(socket.id);
    user.mode = data.mode;
    user.interests = data.interests || [];
    
    // Find match
    let partnerFound = null;
    for (let i = 0; i < queue.length; i++) {
      if (queue[i] !== socket.id) {
        partnerFound = queue[i];
        queue.splice(i, 1);
        break;
      }
    }
    
    if (partnerFound) {
      const roomId = `room_${socket.id}_${partnerFound}`;
      const partner = users.get(partnerFound);
      
      // Set rooms
      user.room = roomId;
      partner.room = roomId;
      
      // Join socket room
      socket.join(roomId);
      io.to(partnerFound).join(roomId);
      
      // Notify both
      io.to(socket.id).emit('matched', {
        partner: {
          id: partner.id,
          name: partner.name || 'Stranger'
        },
        roomId,
        initiator: true
      });
      
      io.to(partnerFound).emit('matched', {
        partner: {
          id: user.id,
          name: user.name || 'Stranger'
        },
        roomId,
        initiator: false
      });
    } else {
      queue.push(socket.id);
      socket.emit('searching');
    }
  });
  
  // WebRTC signaling
  socket.on('webrtc_offer', (data) => {
    socket.to(data.roomId).emit('webrtc_offer', {
      from: socket.id,
      offer: data.offer
    });
  });
  
  socket.on('webrtc_answer', (data) => {
    socket.to(data.roomId).emit('webrtc_answer', {
      from: socket.id,
      answer: data.answer
    });
  });
  
  socket.on('webrtc_ice_candidate', (data) => {
    socket.to(data.roomId).emit('webrtc_ice_candidate', {
      from: socket.id,
      candidate: data.candidate
    });
  });
  
  // Chat messages
  socket.on('chat_message', (data) => {
    const user = users.get(socket.id);
    if (user && user.room) {
      socket.to(user.room).emit('new_message', {
        from: socket.id,
        fromName: user.name,
        content: data.content,
        timestamp: Date.now()
      });
    }
  });
  
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user && user.room) {
      socket.to(user.room).emit('partner_disconnected');
    }
    users.delete(socket.id);
    // Remove from waiting queues
    Object.keys(waitingRooms).forEach(mode => {
      const index = waitingRooms[mode].indexOf(socket.id);
      if (index > -1) waitingRooms[mode].splice(index, 1);
    });
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    users: users.size,
    waiting: {
      chat: waitingRooms.chat.length,
      audio: waitingRooms.audio.length,
      video: waitingRooms.video.length
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
