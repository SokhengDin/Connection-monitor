import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import os from 'os';

import { SystemMetrics } from '../types/connection.type';
import { PublisherService } from '../services/publisher.service';
import { TelegramService } from '../services/telegram.service';
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

app.use(express.json());

const telegramService = process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID
    ? new TelegramService(
        process.env.TELEGRAM_BOT_TOKEN,
        process.env.TELEGRAM_CHAT_ID
    )
    : undefined;

const publisherService = new PublisherService(
    {
        host        : process.env.REDIS_HOST || 'localhost'
        , port      : parseInt(process.env.REDIS_PORT || '6379')
        , password  : process.env.REDIS_PASSWORD
    }
    , io
    , telegramService
);

telegramService?.sendAlert('🟢 Monitoring system started', 'info')
    .catch(err => logger.error('Failed to send startup alert:', err));

// API Routes
app.post('/api/status', async (req, res) => {
    try {
        const { clientId, status, metadata } = req.body;
        
        if (!metadata || !metadata.projectName || !metadata.location || 
            !metadata.installedDate || !metadata.owner) {
            return res.status(400).json({ 
                error: 'Missing required metadata fields' 
            });
        }

        await publisherService.publishConnectionStatus({
            clientId
            , status
            , timestamp: Date.now()
            , metadata: {
                ...metadata,
                ip          : req.ip,
                hostname    : os.hostname()
            }
        });
    
        res.json({ success: true });
    } catch (error) {
        logger.error('Error publishing status:', error);
        res.status(500).json({ error: 'Failed to publish status' });
    }
});


app.post('/api/metrics', async (req, res) => {
    try {
        const { clientId, metadata } = req.body;

        if (!metadata || !metadata.projectName || !metadata.location || 
            !metadata.installedDate || !metadata.owner) {
            return res.status(400).json({ 
                error: 'Missing required metadata fields' 
            });
        }

        const metrics: SystemMetrics = {
            cpuUsage     : os.loadavg()[0]
            , memoryUsage: process.memoryUsage().heapUsed
            , totalMemory: os.totalmem()
            , freeMemory : os.freemem()
            , uptime     : process.uptime()
            , timestamp  : Date.now()
            , clientId
        };

        await publisherService.publishSystemMetrics(metrics);
        res.json({ success: true, metrics });
    } catch (error) {
        logger.error('Error publishing metrics:', error);
        res.status(500).json({ error: 'Failed to publish metrics' });
    }
});

app.post('/api/alerts', async (req, res) => {
    try {
        const { type, message, severity, metadata } = req.body;

        if (!metadata?.projectName || !metadata?.location) {
            return res.status(400).json({
                success: false,
                error: 'Missing required metadata fields (projectName, location)',
                timestamp: Date.now()
            });
        }
        
        await publisherService.publishAlert({
            type,
            message,
            severity,
            timestamp: Date.now(),
            metadata: {
                ...metadata,
                ip: req.ip,
                hostname: os.hostname(),
            }
        });

        res.json({ 
            success: true,
            timestamp: Date.now(),
            metadata
        });
    } catch (error) {
        logger.error('Error publishing alert:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to publish alert',
            timestamp: Date.now()
        });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status    : 'ok'
        , uptime  : process.uptime()
        , memory  : process.memoryUsage()
        , cpu     : os.loadavg()
    });
});


const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    logger.info(`Publisher service running on port ${PORT}`);
});

process.on('SIGTERM', async () => {
    logger.info('SIGTERM received. Starting graceful shutdown...');

    await publisherService.shutdown();


    httpServer.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
    });

    setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
});

process.on('SIGINT', async () => {
    logger.info('SIGINT received. Starting graceful shutdown...');
    await publisherService.shutdown();
    process.exit(0);
});

// Error handling
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection at:', promise, 'reason:', reason);
});