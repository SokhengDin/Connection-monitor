import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import os from 'os';

import { SystemMetrics } from '../types/connection.type';
import { PublisherService } from '../services/publisher.services';
import { logger } from '../utils/logger';

dotenv.config();

const app         = express();
const httpServer  = createServer(app);

const io          = new Server(httpServer, {
  cors: {
    origin    : process.env.ALLOWED_ORIGINS?.split(',') || '*'
    , methods : ['GET', 'POST']
  }
});

app.use(express.json())

const publisherService = new PublisherService({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD
});

// Store connected clients
const connectedClients = new Map<string, {
  socketId: string;
  lastHeartbeat: number;
}>();

// Socket connection
io.on('connection', async(socket) => {
  const clientId  = socket.handshake.auth.clientId;

  if (!clientId) {
    logger.warn('Client attempted connection without clientId');
    socket.disconnect();
    return;
  }

  logger.info(`Client connected: ${clientId}, Socket ID: ${socket.id}`);

  // Store client connection
  connectedClients.set(clientId, {
    socketId  : socket.id
    , lastHeartbeat: Date.now()
  });


  // Handle client heartbeat
  socket.on('heartbeat', async () => {
    const client  = connectedClients.get(clientId);
    if (client) {
      client.lastHeartbeat  = Date.now();
      connectedClients.set(clientId, client);

      // Send heartbeat acknowledgment
      socket.emit('heartbeat:ack', { timestamp: Date.now() });

      // Publish heartbeat
      await publisherService.publishSystemMetrics({
        clientId
        , cpuUsage: os.loadavg()[0]
        , memoryUsage: process.memoryUsage().heapUsed
        , uptime: process.uptime()
        , timestamp: Date.now()
      })
    }
  })

  // Handle client disconnection 
  socket.on('disconnect', async() => {
    logger.info(`Client disconnected: ${clientId}`);
    connectedClients.delete(clientId);

    await publisherService.publishConnectionStatus({
      clientId
      , status: 'offline'
      , timestamp: Date.now()
      , metadata: {
        reason: 'client_disconnected'
      }
    })
  })

  // Handle client system metrics
  socket.on('metrics', async (metrics: SystemMetrics) => {
    await publisherService.publishSystemMetrics({
      ...metrics
      , clientId
      , timestamp: Date.now()
    });
  });
});

// Check for stale connectins

const STALE_CONNTECTION_THRESHOLD  = 60000; // 1 minute
setInterval(() => {
  const now     = Date.now();

  connectedClients.forEach(async (client, clientId)=> {
    if ( now - client.lastHeartbeat  > STALE_CONNTECTION_THRESHOLD) {
      logger.warn(`Stale connection detected for client: ${clientId}`);

      // Get socket and disconnect it
      const socket  = io.sockets.sockets.get(client.socketId);

      if (socket) {
        socket.disconnect(true);
      }

      connectedClients.delete(clientId);

      await publisherService.publishConnectionStatus({
        clientId
        , status: 'offline'
        , timestamp: now
        , metadata: {
          reason: 'stale_connection'
        }
      });
    }
  });
}, 30000); // Check for every 30 seconds

// publish client
app.post('/api/status', async (req, res) => {
    try {
      const { clientId, status } = req.body;
      
      await publisherService.publishConnectionStatus({
        clientId,
        status,
        timestamp: Date.now(),
        metadata: {
          ip: req.ip,
          hostname: os.hostname()
        }
      });
  
      res.json({ success: true });
    } catch (error) {
      logger.error('Error publishing status:', error);
      res.status(500).json({ error: 'Failed to publish status' });
    }
});

// publish system metrics
app.post('/api/metrics', async (req, res) => {
try {
    const metrics: SystemMetrics = {
    cpuUsage: os.loadavg()[0], // 1 minute load average
    memoryUsage: process.memoryUsage().heapUsed,
    uptime: process.uptime(),
    timestamp: Date.now()
    };

    await publisherService.publishSystemMetrics(metrics);
    res.json({ success: true, metrics });
} catch (error) {
    logger.error('Error publishing metrics:', error);
    res.status(500).json({ error: 'Failed to publish metrics' });
}
});

// publish alerts
app.post('/api/alerts', async (req, res) => {
try {
    const { type, message, severity } = req.body;
    
    await publisherService.publishAlert({
      type,
      message,
      severity
    });

    // Broadcasting alert to all connected clients
    io.emit('alert', {
      type
      , message
      , severity
      , timestamp: Date.now()
    });

    res.json({ success: true });
} catch (error) {
    logger.error('Error publishing alert:', error);
    res.status(500).json({ error: 'Failed to publish alert' });
}
});

const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
    logger.info(`Publisher service running on port ${PORT}`);
});


process.on('SIGTERM', async () => {
    // Disconnect all clients
    io.disconnectSockets();

    // Close socket.io server
    await new Promise<void>((resolve) =>io.close(() => resolve()));

    // Shutdown publisher service
    await publisherService.shutdown();

    process.exit(0);
});