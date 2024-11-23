"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublisherService = void 0;
const os_1 = __importDefault(require("os"));
const ioredis_1 = __importDefault(require("ioredis"));
const channels_1 = require("../constants/channels");
const logger_1 = require("../utils/logger");
class PublisherService {
    constructor(redisConfig, io, telegram) {
        this.redisConfig = redisConfig;
        this.io = io;
        this.telegram = telegram;
        this.connected = false;
        this.connectedClients = new Map();
        this.publisher = new ioredis_1.default(redisConfig);
        this.subscriber = new ioredis_1.default(redisConfig);
        this.setupRedisListeners();
        this.setupSocketServer();
        this.startHealthCheck();
    }
    setupRedisListeners() {
        this.publisher.on('connect', () => {
            var _a;
            this.connected = true;
            logger_1.logger.info('Publisher connected to Redis');
            (_a = this.telegram) === null || _a === void 0 ? void 0 : _a.sendAlert('🟢 Monitoring system connected to Redis', 'info');
        });
        this.publisher.on('error', (error) => {
            var _a;
            this.connected = false;
            logger_1.logger.error('Redis connection error:', error);
            (_a = this.telegram) === null || _a === void 0 ? void 0 : _a.sendAlert('🔴 Redis connection error', 'error');
        });
        // Subscribe to channels
        this.subscriber.subscribe(channels_1.CHANNELS.CONNECTION_STATUS, channels_1.CHANNELS.SYSTEM_METRICS, channels_1.CHANNELS.ALERTS);
        this.subscriber.on('message', async (channel, message) => {
            try {
                const data = JSON.parse(message);
                switch (channel) {
                    case channels_1.CHANNELS.CONNECTION_STATUS:
                        await this.handleConnectionStatus(data);
                        break;
                    case channels_1.CHANNELS.SYSTEM_METRICS:
                        await this.handleSystemMetrics(data);
                        break;
                    case channels_1.CHANNELS.ALERTS:
                        await this.handleAlert(data);
                        break;
                }
            }
            catch (error) {
                logger_1.logger.error('Error handling Redis message:', error);
            }
        });
    }
    setupSocketServer() {
        this.io.on('connection', (socket) => {
            const clientId = socket.handshake.auth.clientId;
            const metadata = socket.handshake.auth.metadata;
            if (!clientId) {
                logger_1.logger.warn('Client attempted connection without clientId');
                socket.disconnect();
                return;
            }
            logger_1.logger.info(`Client connected: ${clientId}`);
            this.registerClient(clientId, metadata);
            socket.on('heartbeat', async (data) => {
                const client = this.connectedClients.get(clientId);
                if (client) {
                    client.lastHeartbeat = Date.now();
                    client.metadata = data.metadata;
                    this.connectedClients.set(clientId, client);
                }
            });
            socket.on('metrics', async (metrics) => {
                await this.publishSystemMetrics({
                    ...metrics,
                    clientId
                });
                const client = this.connectedClients.get(clientId);
                if (client) {
                    client.lastHeartbeat = Date.now();
                    client.metrics = metrics;
                    client.metadata = metrics.metadata;
                    this.connectedClients.set(clientId, client);
                }
            });
            socket.on('disconnect', async () => {
                const client = this.connectedClients.get(clientId);
                await this.publishConnectionStatus({
                    clientId,
                    status: 'offline',
                    timestamp: Date.now(),
                    metadata: {
                        ...client === null || client === void 0 ? void 0 : client.metadata,
                        reason: 'client_disconnected',
                        lastHeartbeat: client === null || client === void 0 ? void 0 : client.lastHeartbeat
                    }
                });
            });
        });
    }
    registerClient(clientId, metadata) {
        this.connectedClients.set(clientId, {
            lastHeartbeat: Date.now(),
            status: 'online',
            metadata
        });
        this.publishConnectionStatus({
            clientId,
            status: 'online',
            timestamp: Date.now(),
            metadata: {
                ...metadata,
                reason: 'initial_connection'
            }
        }).catch(error => {
            logger_1.logger.error('Error publishing initial connection status:', error);
        });
    }
    startHealthCheck() {
        const CHECK_INTERVAL = parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000'); // 30 seconds
        const OFFLINE_THRESHOLD = parseInt(process.env.OFFLINE_THRESHOLD || '60000'); // 1 minute
        const REPORT_INTERVAL = parseInt(process.env.REPORT_INTERVAL || '300000'); // 5 minutes
        setInterval(async () => {
            const now = Date.now();
            for (const [clientId, client] of this.connectedClients.entries()) {
                // Check if client is stale
                if (client.status === 'online' && now - client.lastHeartbeat > OFFLINE_THRESHOLD) {
                    await this.handleClientOffline(clientId, client);
                }
                if (client.status === 'online' &&
                    client.metrics &&
                    now - client.lastHeartbeat < OFFLINE_THRESHOLD) {
                    await this.sendHealthReport(clientId, client);
                }
            }
        }, CHECK_INTERVAL);
    }
    async handleClientOffline(clientId, client) {
        var _a, _b, _c, _d;
        const metadata = {
            projectName: ((_a = client.metadata) === null || _a === void 0 ? void 0 : _a.projectName) || 'Unknown',
            location: ((_b = client.metadata) === null || _b === void 0 ? void 0 : _b.location) || 'Unknown',
            clientId,
            hostname: (_c = client.metadata) === null || _c === void 0 ? void 0 : _c.hostname,
            version: (_d = client.metadata) === null || _d === void 0 ? void 0 : _d.version,
            additionalInfo: {
                lastHeartbeat: client.lastHeartbeat,
                lastSeenAt: new Date(client.lastHeartbeat).toLocaleString()
            }
        };
        await this.publishAlert({
            type: 'CONNECTION_LOST',
            message: 'Client connection lost due to heartbeat timeout',
            severity: 'error',
            timestamp: Date.now(),
            metadata
        });
        client.status = 'offline';
        this.connectedClients.set(clientId, client);
    }
    async handleHighCpuUsage(clientId, client, cpuUsage) {
        var _a, _b, _c, _d;
        await this.publishAlert({
            type: 'HIGH_CPU_USAGE',
            message: `CPU usage exceeded threshold: ${cpuUsage.toFixed(2)}%`,
            severity: 'warning',
            metadata: {
                projectName: ((_a = client.metadata) === null || _a === void 0 ? void 0 : _a.projectName) || 'Unknown',
                location: ((_b = client.metadata) === null || _b === void 0 ? void 0 : _b.location) || 'Unknown',
                clientId,
                hostname: (_c = client.metadata) === null || _c === void 0 ? void 0 : _c.hostname,
                version: (_d = client.metadata) === null || _d === void 0 ? void 0 : _d.version,
                additionalInfo: {
                    cpuUsage,
                    threshold: 80
                }
            }
        });
    }
    async handleHighMemoryUsage(clientId, client, memoryUsagePercent) {
        var _a, _b, _c, _d;
        await this.publishAlert({
            type: 'HIGH_MEMORY_USAGE',
            message: `Memory usage exceeded threshold: ${memoryUsagePercent.toFixed(2)}%`,
            severity: 'warning',
            metadata: {
                projectName: ((_a = client.metadata) === null || _a === void 0 ? void 0 : _a.projectName) || 'Unknown',
                location: ((_b = client.metadata) === null || _b === void 0 ? void 0 : _b.location) || 'Unknown',
                clientId,
                hostname: (_c = client.metadata) === null || _c === void 0 ? void 0 : _c.hostname,
                version: (_d = client.metadata) === null || _d === void 0 ? void 0 : _d.version,
                additionalInfo: {
                    memoryUsage: memoryUsagePercent,
                    threshold: 90
                }
            }
        });
    }
    async sendHealthReport(clientId, client) {
        var _a;
        if (!client.metrics || !client.metadata)
            return;
        const memoryUsagePercent = (client.metrics.memoryUsage / client.metrics.totalMemory) * 100;
        const message = `📊 Health Report
<code>
Client: ${clientId}
Project: ${client.metadata.projectName}
Location: ${client.metadata.location}

System Metrics:
- CPU Usage: ${client.metrics.cpuUsage.toFixed(2)}%
- Memory: ${memoryUsagePercent.toFixed(2)}%
- Uptime: ${(client.metrics.uptime / 3600).toFixed(2)} hours
- Last Update: ${new Date(client.metrics.timestamp).toLocaleString()}

Status: ${client.status.toUpperCase()}
</code>`;
        await ((_a = this.telegram) === null || _a === void 0 ? void 0 : _a.sendAlert(message, 'info'));
    }
    async handleConnectionStatus(status) {
        var _a, _b, _c, _d, _e, _f, _g;
        const client = this.connectedClients.get(status.clientId);
        if (status.status === 'online') {
            this.connectedClients.set(status.clientId, {
                lastHeartbeat: Date.now(),
                status: 'online',
                metadata: status.metadata
            });
            if (!client || client.status === 'offline') {
                const message = `🟢 Client Connected
<code>
Client ID: ${status.clientId}
Project: ${((_a = status.metadata) === null || _a === void 0 ? void 0 : _a.projectName) || 'Unknown'}
Location: ${((_b = status.metadata) === null || _b === void 0 ? void 0 : _b.location) || 'Unknown'}
Time: ${new Date().toLocaleString()}
</code>`;
                await ((_c = this.telegram) === null || _c === void 0 ? void 0 : _c.sendAlert(message, 'info'));
            }
        }
        else {
            if ((client === null || client === void 0 ? void 0 : client.status) === 'online') {
                const message = `🔴 Client Disconnected
<code>
Client ID: ${status.clientId}
Project: ${((_d = client.metadata) === null || _d === void 0 ? void 0 : _d.projectName) || 'Unknown'}
Location: ${((_e = client.metadata) === null || _e === void 0 ? void 0 : _e.location) || 'Unknown'}
Time: ${new Date().toLocaleString()}
Reason: ${((_f = status.metadata) === null || _f === void 0 ? void 0 : _f.reason) || 'Unknown'}
</code>`;
                await ((_g = this.telegram) === null || _g === void 0 ? void 0 : _g.sendAlert(message, 'warning'));
            }
            this.connectedClients.set(status.clientId, {
                ...client,
                lastHeartbeat: status.timestamp,
                status: 'offline'
            });
        }
    }
    async handleSystemMetrics(metrics) {
        var _a, _b, _c, _d;
        const client = this.connectedClients.get(metrics.clientId);
        if (!client)
            return;
        // Update client state
        client.lastHeartbeat = Date.now();
        client.metrics = metrics;
        const memoryUsagePercent = (metrics.memoryUsage / metrics.totalMemory) * 100;
        const baseMetadata = {
            projectName: ((_a = client.metadata) === null || _a === void 0 ? void 0 : _a.projectName) || 'Unknown',
            location: ((_b = client.metadata) === null || _b === void 0 ? void 0 : _b.location) || 'Unknown',
            clientId: metrics.clientId,
            hostname: ((_c = client.metadata) === null || _c === void 0 ? void 0 : _c.hostname) || os_1.default.hostname(),
            version: (_d = client.metadata) === null || _d === void 0 ? void 0 : _d.version,
            component: 'System Monitor'
        };
        // Check CPU threshold
        if (metrics.cpuUsage > 80) {
            await this.publishAlert({
                type: 'HIGH_CPU_USAGE',
                message: 'Critical CPU usage detected',
                severity: 'warning',
                metadata: {
                    ...baseMetadata,
                    additionalInfo: {
                        currentUsage: metrics.cpuUsage.toFixed(2) + '%',
                        threshold: '80%',
                        loadAverage: os_1.default.loadavg(),
                        cpuCount: os_1.default.cpus().length,
                        timestamp: new Date().toLocaleString()
                    }
                }
            });
        }
        if (memoryUsagePercent > 90) {
            await this.publishAlert({
                type: 'HIGH_MEMORY_USAGE',
                message: 'Critical memory usage detected',
                severity: 'warning',
                metadata: {
                    ...baseMetadata,
                    additionalInfo: {
                        currentUsage: memoryUsagePercent.toFixed(2) + '%',
                        threshold: '90%',
                        totalMemory: (metrics.totalMemory / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
                        usedMemory: (metrics.memoryUsage / (1024 * 1024)).toFixed(2) + ' MB',
                        freeMemory: (metrics.freeMemory / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
                        timestamp: new Date().toLocaleString()
                    }
                }
            });
        }
        const REPORT_INTERVAL = parseInt(process.env.REPORT_INTERVAL || '300000'); // 5 minutes
        const shouldSendReport = Date.now() - (client.lastReport || 0) > REPORT_INTERVAL;
        if (shouldSendReport) {
            await this.publishAlert({
                type: 'SYSTEM_HEALTH_REPORT',
                message: 'Periodic system health report',
                severity: 'info',
                metadata: {
                    ...baseMetadata,
                    additionalInfo: {
                        cpuUsage: metrics.cpuUsage.toFixed(2) + '%',
                        memoryUsage: memoryUsagePercent.toFixed(2) + '%',
                        totalMemory: (metrics.totalMemory / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
                        freeMemory: (metrics.freeMemory / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
                        uptime: (metrics.uptime / 3600).toFixed(2) + ' hours',
                        loadAverage: os_1.default.loadavg(),
                        timestamp: new Date().toLocaleString()
                    }
                }
            });
            client.lastReport = Date.now();
        }
        this.connectedClients.set(metrics.clientId, client);
    }
    async handleAlert(alert) {
        var _a;
        const formattedMessage = this.formatAlertMessage(alert);
        await ((_a = this.telegram) === null || _a === void 0 ? void 0 : _a.sendAlert(formattedMessage, alert.severity));
        this.io.emit('alert', alert);
    }
    async publishConnectionStatus(status) {
        try {
            if (!this.connected) {
                throw new Error('Redis publisher not connected');
            }
            await this.publisher.publish(channels_1.CHANNELS.CONNECTION_STATUS, JSON.stringify(status));
            logger_1.logger.info(`Published connection status for client ${status.clientId}`);
        }
        catch (error) {
            logger_1.logger.error('Error publishing connection status:', error);
            throw error;
        }
    }
    async publishSystemMetrics(metrics) {
        try {
            if (!this.connected) {
                throw new Error('Redis publisher not connected');
            }
            await this.publisher.publish(channels_1.CHANNELS.SYSTEM_METRICS, JSON.stringify(metrics));
            logger_1.logger.debug('Published system metrics');
        }
        catch (error) {
            logger_1.logger.error('Error publishing system metrics:', error);
            throw error;
        }
    }
    async publishAlert(alert) {
        var _a;
        try {
            if (!this.connected) {
                throw new Error('Redis publisher not connected');
            }
            const alertData = {
                ...alert,
                timestamp: alert.timestamp || Date.now()
            };
            await this.publisher.publish(channels_1.CHANNELS.ALERTS, JSON.stringify(alertData));
            const formattedMessage = this.formatAlertMessage(alertData);
            await ((_a = this.telegram) === null || _a === void 0 ? void 0 : _a.sendAlert(formattedMessage, alert.severity));
            this.io.emit('alert', alertData);
            logger_1.logger.info(`Published alert: ${alert.type} for ${alert.metadata.projectName}`);
        }
        catch (error) {
            logger_1.logger.error('Error publishing alert:', error);
            throw error;
        }
    }
    formatAlertMessage(alert) {
        const emoji = {
            info: 'ℹ️',
            warning: '⚠️',
            error: '🚨'
        }[alert.severity];
        return `${emoji} <b>${alert.type}</b>

<code>
Message: ${alert.message}
Project: ${alert.metadata.projectName}
Location: ${alert.metadata.location}
${alert.metadata.component ? `Component: ${alert.metadata.component}` : ''}
${alert.metadata.clientId ? `Client ID: ${alert.metadata.clientId}` : ''}
Time: ${new Date(alert.timestamp || Date.now()).toLocaleString()}
</code>

${alert.metadata.additionalInfo ? `\nAdditional Info:\n<code>${JSON.stringify(alert.metadata.additionalInfo, null, 2)}</code>` : ''}`;
    }
    async shutdown() {
        var _a, _b;
        logger_1.logger.info('Publisher service shutting down...');
        await ((_a = this.telegram) === null || _a === void 0 ? void 0 : _a.sendAlert('🔄 Monitoring system shutting down...', 'warning'));
        this.io.disconnectSockets();
        await this.subscriber.quit();
        await this.publisher.quit();
        await ((_b = this.telegram) === null || _b === void 0 ? void 0 : _b.shutdown());
        this.connected = false;
        logger_1.logger.info('Publisher service shut down complete');
    }
}
exports.PublisherService = PublisherService;
