"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const os_1 = __importDefault(require("os"));
const publisher_service_1 = require("../services/publisher.service");
const telegram_service_1 = require("../services/telegram.service");
const logger_1 = require("../utils/logger");
dotenv_1.default.config();
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: ((_a = process.env.ALLOWED_ORIGINS) === null || _a === void 0 ? void 0 : _a.split(',')) || '*',
        methods: ['GET', 'POST']
    }
});
app.use(express_1.default.json());
const telegramService = process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID
    ? new telegram_service_1.TelegramService(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID)
    : undefined;
const publisherService = new publisher_service_1.PublisherService({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD
}, io, telegramService);
telegramService === null || telegramService === void 0 ? void 0 : telegramService.sendAlert('🟢 Monitoring system started', 'info').catch(err => logger_1.logger.error('Failed to send startup alert:', err));
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
            clientId,
            status,
            timestamp: Date.now(),
            metadata: {
                ...metadata,
                ip: req.ip,
                hostname: os_1.default.hostname()
            }
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error('Error publishing status:', error);
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
        const metrics = {
            cpuUsage: os_1.default.loadavg()[0],
            memoryUsage: process.memoryUsage().heapUsed,
            totalMemory: os_1.default.totalmem(),
            freeMemory: os_1.default.freemem(),
            uptime: process.uptime(),
            timestamp: Date.now(),
            clientId
        };
        await publisherService.publishSystemMetrics(metrics);
        res.json({ success: true, metrics });
    }
    catch (error) {
        logger_1.logger.error('Error publishing metrics:', error);
        res.status(500).json({ error: 'Failed to publish metrics' });
    }
});
app.post('/api/alerts', async (req, res) => {
    try {
        const { type, message, severity, metadata } = req.body;
        if (!(metadata === null || metadata === void 0 ? void 0 : metadata.projectName) || !(metadata === null || metadata === void 0 ? void 0 : metadata.location)) {
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
                hostname: os_1.default.hostname(),
            }
        });
        res.json({
            success: true,
            timestamp: Date.now(),
            metadata
        });
    }
    catch (error) {
        logger_1.logger.error('Error publishing alert:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to publish alert',
            timestamp: Date.now()
        });
    }
});
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: os_1.default.loadavg()
    });
});
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    logger_1.logger.info(`Publisher service running on port ${PORT}`);
});
process.on('SIGTERM', async () => {
    logger_1.logger.info('SIGTERM received. Starting graceful shutdown...');
    await publisherService.shutdown();
    httpServer.close(() => {
        logger_1.logger.info('HTTP server closed');
        process.exit(0);
    });
    setTimeout(() => {
        logger_1.logger.error('Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
});
process.on('SIGINT', async () => {
    logger_1.logger.info('SIGINT received. Starting graceful shutdown...');
    await publisherService.shutdown();
    process.exit(0);
});
// Error handling
process.on('uncaughtException', (error) => {
    logger_1.logger.error('Uncaught exception:', error);
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    logger_1.logger.error('Unhandled rejection at:', promise, 'reason:', reason);
});
