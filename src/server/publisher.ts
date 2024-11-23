import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import os from 'os';
import cors from 'cors';

import { SystemMetrics } from '../types/connection.type';
import { PublisherService } from '../services/publisher.service';
import { TelegramService } from '../services/telegram.service';
import { logger } from '../utils/logger';

dotenv.config();

const app = express();
const httpServer = createServer(app);

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(','),
    methods: ['GET', 'POST']
}));

const io = new Server(httpServer, {
    cors: {
        origin: process.env.ALLOWED_ORIGINS?.split(','),
        methods: ['GET', 'POST']
    }
});

app.use(express.json());

const telegramService = process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID
    ? new TelegramService(
        process.env.TELEGRAM_BOT_TOKEN,
        process.env.TELEGRAM_CHAT_ID
    )
    : undefined;

const publisherService = new PublisherService(
    {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD
    },
    io,
    telegramService
);

telegramService?.sendAlert(`🟢 System Online\n<code>Server: ${os.hostname()}</code>`, 'info');

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: os.loadavg()
    });
});

app.post('/api/status', async (req, res) => {
    try {
        const { clientId, status, metadata } = req.body;
        
        if (!metadata?.projectName || !metadata?.location) {
            return res.status(400).json({ error: 'Missing metadata fields' });
        }

        await publisherService.publishConnectionStatus({
            clientId,
            status,
            timestamp: Date.now(),
            metadata: {
                ...metadata,
                ip: req.ip,
                hostname: os.hostname()
            }
        });
    
        res.json({ success: true });
    } catch (error) {
        logger.error('Status update failed:', error);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

app.post('/api/metrics', async (req, res) => {
    try {
        const { clientId, metadata } = req.body;

        if (!metadata?.projectName || !metadata?.location) {
            return res.status(400).json({ error: 'Missing metadata fields' });
        }

        const metrics: SystemMetrics = {
            cpuUsage: os.loadavg()[0],
            memoryUsage: process.memoryUsage().heapUsed,
            totalMemory: os.totalmem(),
            freeMemory: os.freemem(),
            uptime: process.uptime(),
            timestamp: Date.now(),
            clientId
        };

        await publisherService.publishSystemMetrics(metrics);
        res.json({ success: true, metrics });
    } catch (error) {
        logger.error('Metrics update failed:', error);
        res.status(500).json({ error: 'Failed to update metrics' });
    }
});

app.post('/api/alerts', async (req, res) => {
    try {
        const { type, message, severity, metadata } = req.body;

        if (!metadata?.projectName || !metadata?.location) {
            return res.status(400).json({ error: 'Missing metadata fields' });
        }
        
        await publisherService.publishAlert({
            type,
            message,
            severity,
            timestamp: Date.now(),
            metadata: {
                ...metadata,
                ip: req.ip,
                hostname: os.hostname()
            }
        });

        res.json({ success: true });
    } catch (error) {
        logger.error('Alert failed:', error);
        res.status(500).json({ error: 'Failed to send alert' });
    }
});

const gracefulShutdown = async () => {
    await telegramService?.sendAlert(`🔴 System Offline\n<code>Server: ${os.hostname()}</code>`, 'warning');
    await publisherService.shutdown();
    process.exit(0);
};

const port = parseInt(process.env.PORT || '3000', 10);
app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
});

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);