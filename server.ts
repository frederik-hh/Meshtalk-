import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const server = createServer(app);
  const io = new Server(server, {
    cors: { origin: '*' }
  });

  const PORT = 3000;

  // Active peers dictionary via socket.id
  const activePeers = new Map<string, { id: string, name: string, avatar: string | null, publicKey: string | null, socketId: string }>();

  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // When a peer introduces themselves
    socket.on('announce', (data: { id: string, name: string, avatar: string | null, publicKey: string | null }) => {
      const peerInfo = { id: data.id, name: data.name, avatar: data.avatar, publicKey: data.publicKey, socketId: socket.id };
      activePeers.set(socket.id, peerInfo);
      
      // Broadcast to everyone else
      socket.broadcast.emit('peer_joined', peerInfo);
      
      // Send the current list of peers to the new client
      const list = Array.from(activePeers.values()).filter(p => p.socketId !== socket.id);
      socket.emit('peer_list', list);
    });

    // WebRTC Signaling
    socket.on('signal', (data: { to: string, signal: any, from: string }) => {
      // Find the socket id of the 'to' peer
      const toPeer = Array.from(activePeers.values()).find(p => p.id === data.to);
      if (toPeer) {
        io.to(toPeer.socketId).emit('signal', {
          from: data.from,
          signal: data.signal
        });
      }
    });

    // Fallback: Relay message if P2P connection fails across different networks
    socket.on('relay_message', (data: { to: string, from: string, msgData: any }) => {
      const toPeer = Array.from(activePeers.values()).find(p => p.id === data.to);
      if (toPeer) {
        io.to(toPeer.socketId).emit('relay_message', {
          from: data.from,
          msgData: data.msgData
        });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
      const peerInfo = activePeers.get(socket.id);
      if (peerInfo) {
        activePeers.delete(socket.id);
        io.emit('peer_left', { id: peerInfo.id });
      }
    });
  });

  try {
    if (process.env.NODE_ENV !== 'production') {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(__dirname, 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
