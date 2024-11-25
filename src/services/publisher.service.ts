import os from 'os';
import Redis from "ioredis";
import { Server } from 'socket.io';
import { CHANNELS } from "../constants/channels";
import { ConnectionStatus, SystemMetrics, ClientMetadata, Alert } from "../types/connection.type";
import { TelegramService } from "./telegram.service";
import { DatabaseService } from './database.service';
import { logger } from "../utils/logger";

interface ConnectedClient {
    lastHeartbeat   : number;
    lastReport?     : number;
    status          : 'online' | 'offline';
    metadata?       : ClientMetadata;
    metrics?        : SystemMetrics;
}

export class PublisherService {
    private publisher   : Redis;
    private subscriber  : Redis;
    private connected   : boolean = false;
    private clientCheckInterval?: NodeJS.Timeout;
    private connectedClients = new Map<string, ConnectedClient>();
    private database: DatabaseService;

    constructor(
        private readonly redisConfig: { host: string; port: number; password?: string },
        private readonly io         : Server,
        private readonly telegram?  : TelegramService
    ) {
        this.database       = new DatabaseService();
        this.publisher      = new Redis(redisConfig);
        this.subscriber     = new Redis(redisConfig);
        this.setupRedisListeners();
        this.setupSocketServer();
        // this.startHealthCheck();
        this.startClientMonitoring();
    }


    private setupRedisListeners(): void {
        this.publisher.on('connect', () => {
            this.connected  = true;
            logger.info('Publisher connected to Redis');
            this.telegram?.sendAlert('🟢 Monitoring system connected to Redis', 'info');
        });

        this.publisher.on('error', (error) => {
            this.connected  = false;
            logger.error('Redis connection error:', error);
            this.telegram?.sendAlert('🔴 Redis connection error', 'error');
        });

        // Subscribe to channels
        this.subscriber.subscribe(CHANNELS.CONNECTION_STATUS, CHANNELS.SYSTEM_METRICS, CHANNELS.ALERTS);

        this.subscriber.on('message', async(channel, message) => {
            try {
                const data    = JSON.parse(message);
                switch (channel) {
                    case CHANNELS.CONNECTION_STATUS:
                        await this.handleConnectionStatus(data);
                        break;
                    // case CHANNELS.SYSTEM_METRICS:
                    //     await this.handleSystemMetrics(data);
                    //     break;
                    // case CHANNELS.ALERTS:
                    //     await this.handleAlert(data);
                    //     break;
                }
            } catch (error) {
                logger.error('Error handling Redis message:', error);
            }
        });
    }

    private setupSocketServer(): void {
        this.io.on('connection', (socket) => {
            const clientId = socket.handshake.auth.clientId;
            const metadata = socket.handshake.auth.metadata as ClientMetadata;

            if (!clientId) {
                logger.warn('Client attempted connection without clientId');
                socket.disconnect();
                return;
            }

            logger.info(`Client connected: ${clientId}`);
            this.registerClient(clientId, metadata);

            socket.on('heartbeat', async (data: { metadata: ClientMetadata }) => {
                const client = this.connectedClients.get(clientId);
                if (client) {
                    client.lastHeartbeat = Date.now();
                    client.metadata = data.metadata;
                    this.connectedClients.set(clientId, client);
                }
            });

            socket.on('metrics', async (metrics: SystemMetrics & { metadata: ClientMetadata }) => {
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
                        ...client?.metadata,
                        reason: 'client_disconnected',
                        lastHeartbeat: client?.lastHeartbeat
                    }
                });
            });
        });
    }

    private async registerClient(clientId: string, metadata?: ClientMetadata): Promise<void> {
        this.connectedClients.set(clientId, {
            lastHeartbeat: Date.now(),
            status: 'online',
            metadata
        });

        await this.database.recordConnectionStatus(clientId, 'online', metadata);

        this.publishConnectionStatus({
            clientId,
            status: 'online',
            timestamp: Date.now(),
            metadata: {
                ...metadata,
                reason: 'initial_connection'
            }
        }).catch(error => {
            logger.error('Error publishing initial connection status:', error);
        });
    }


    private startClientMonitoring(): void {
        const CHECK_INTERVAL = 60000;
        const OFFLINE_THRESHOLD = 5 * 60 * 1000; // 5 minutes in milliseconds
    
        logger.info('Starting client monitoring service...');
    
        this.clientCheckInterval = setInterval(async () => {
            try {
                logger.debug('Checking client statuses...');
    
                // Get all unique client IDs from database
                const [rows] = await this.database.pool.execute<mysql.RowDataPacket[]>(
                    `SELECT DISTINCT client_id, project_name, location, last_seen 
                     FROM connections 
                     WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
                     GROUP BY client_id`
                );
    
                const activeClients = Array.from(this.connectedClients.values())
                    .filter(client => client.status === 'online');
    
                logger.debug(`Found ${rows.length} registered clients and ${activeClients.length} active clients`);
    
                // Check each registered client
                for (const row of rows) {
                    const clientId = row.client_id;
                    const isConnected = activeClients.some(client => client.clientId === clientId);
                    const timeSinceLastSeen = Date.now() - row.last_seen;
    
                    logger.debug(`Checking client ${clientId}: isConnected=${isConnected}, timeSinceLastSeen=${timeSinceLastSeen}ms`);
    
                    if (!isConnected && timeSinceLastSeen > OFFLINE_THRESHOLD) {
                        logger.warn(`Client ${clientId} (${row.project_name}) detected as offline. Last seen: ${new Date(row.last_seen).toLocaleString()}`);
    
                        // Record offline status in database
                        await this.database.recordConnectionStatus(
                            clientId,
                            'offline',
                            {
                                projectName: row.project_name,
                                location: row.location
                            } as Partial<ClientMetadata>,
                            'connection_lost'
                        );
    
                        logger.info(`Recorded offline status for client ${clientId} in database`);
    
                        // Send alerts
                        this.telegram?.sendAlert(`⚠️ System Warning
    <code>
    Client Disconnected
    Client ID: ${clientId}
    Project: ${row.project_name}
    Location: ${row.location}
    Last Seen: ${new Date(row.last_seen).toLocaleString()}
    </code>`, 'warning');
    
                        // Send Khmer alert
                        this.telegram?.sendKhmerDesktopDownAlert({
                            projectName: row.project_name,
                            location: row.location,
                            lastHeartbeat: row.last_seen,
                            reason: 'connection_lost'
                        });
    
                        logger.info(`Sent alerts for offline client ${clientId}`);
                    }
                }
    
                // If no active clients at all
                if (activeClients.length === 0) {
                    logger.warn('No active clients connected');
                    
                    this.telegram?.sendAlert(`⚠️ System Warning
    <code>
    No active clients connected
    Time: ${new Date().toLocaleString()}
    Last Known Clients:
    ${this.getLastKnownClientsInfo()}
    </code>`, 'warning');
                }
    
            } catch (error) {
                logger.error('Error in client monitoring:', error);
                if (error instanceof Error) {
                    logger.error(`Stack trace: ${error.stack}`);
                }
            }
        }, CHECK_INTERVAL);
    
        logger.info(`Client monitoring started with ${CHECK_INTERVAL}ms interval`);
    }

    private async handleClientOffline(clientId: string, client: ConnectedClient): Promise<void> {
        const metadata = {
            projectName: client.metadata?.projectName || 'Unknown',
            location: client.metadata?.location || 'Unknown',
            clientId,
            hostname: client.metadata?.hostname,
            version: client.metadata?.version,
            additionalInfo: {
                lastHeartbeat: client.lastHeartbeat,
                lastSeenAt: new Date(client.lastHeartbeat).toLocaleString()
            }
        };

        // dnb
        await this.database.recordConnectionStatus(
            clientId
            , 'offline'
            , client.metadata
            , 'heartbeat_timeout'
        );

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

    private async handleHighCpuUsage(clientId: string, client: ConnectedClient, cpuUsage: number): Promise<void> {
        await this.publishAlert({
            type: 'HIGH_CPU_USAGE',
            message: `CPU usage exceeded threshold: ${cpuUsage.toFixed(2)}%`,
            severity: 'warning',
            metadata: {
                projectName: client.metadata?.projectName || 'Unknown',
                location: client.metadata?.location || 'Unknown',
                clientId,
                hostname: client.metadata?.hostname,
                version: client.metadata?.version,
                additionalInfo: {
                    cpuUsage,
                    threshold: 80
                }
            }
        });
    }

    private async handleHighMemoryUsage(clientId: string, client: ConnectedClient, memoryUsagePercent: number): Promise<void> {
        await this.publishAlert({
            type: 'HIGH_MEMORY_USAGE',
            message: `Memory usage exceeded threshold: ${memoryUsagePercent.toFixed(2)}%`,
            severity: 'warning',
            metadata: {
                projectName: client.metadata?.projectName || 'Unknown',
                location: client.metadata?.location || 'Unknown',
                clientId,
                hostname: client.metadata?.hostname,
                version: client.metadata?.version,
                additionalInfo: {
                    memoryUsage: memoryUsagePercent,
                    threshold: 90
                }
            }
        });
    }


//     private async sendHealthReport(clientId: string, client: ConnectedClient): Promise<void> {
//         if (!client.metrics || !client.metadata) return;

//         const memoryUsagePercent = (client.metrics.memoryUsage / client.metrics.totalMemory) * 100;
//         const message = `📊 Health Report
// <code>
// Client: ${clientId}
// Project: ${client.metadata.projectName}
// Location: ${client.metadata.location}

// System Metrics:
// - CPU Usage: ${client.metrics.cpuUsage.toFixed(2)}%
// - Memory: ${memoryUsagePercent.toFixed(2)}%
// - Uptime: ${(client.metrics.uptime / 3600).toFixed(2)} hours
// - Last Update: ${new Date(client.metrics.timestamp).toLocaleString()}

// Status: ${client.status.toUpperCase()}
// </code>`;

//         await this.telegram?.sendAlert(message, 'info');
//     }

    private async handleConnectionStatus(status: ConnectionStatus): Promise<void> {
        const client = this.connectedClients.get(status.clientId);
        const metadata = status.metadata;
        

        if (status.status === 'online') {
            this.connectedClients.set(status.clientId, {
                lastHeartbeat: Date.now(),
                status: 'online',
                metadata: status.metadata as ClientMetadata
            });

            if (!client || client.status === 'offline') {

                const { lastDowntime }  = await this.database.getDowntimeStats(status.clientId);

                const downtimeStr       = lastDowntime 
                ? `\nLast Downtime: ${Math.floor(lastDowntime / 60)}m ${lastDowntime % 60}s`
                : '';

                await this.telegram?.sendAlert(`🟢 Client Connected
<code>
Client: ${status.clientId}
Project: ${metadata?.projectName || 'Unknown'}
Location: ${metadata?.location || 'Unknown'}
Owner: ${metadata?.owner || 'Unknown'}
Time: ${new Date().toLocaleString()}${downtimeStr}
</code>`, 'info');
                    

            await this.database.recordConnectionStatus(
                status.clientId
                , 'online'
                , metadata as ClientMetadata
            )

            }
        } else {
            if (client?.status === 'online') {
                await this.database.recordConnectionStatus(
                    status.clientId,
                    'offline',
                    metadata as ClientMetadata,
                    status.metadata?.reason
                );

                const message = `🔴 Client Disconnected
<code>
Client: ${status.clientId}
Project: ${metadata?.projectName || 'Unknown'}
Location: ${metadata?.location || 'Unknown'}
Owner: ${metadata?.owner || 'Unknown'}
Time: ${new Date().toLocaleString()}
Reason: ${status.metadata?.reason || 'Unknown'}
</code>`

                await this.telegram?.sendAlert(message, 'warning');
            }

            this.connectedClients.set(status.clientId, {
                ...client,
                lastHeartbeat: status.timestamp,
                status: 'offline'
            });

            const remainingActiveClients    = Array.from(this.connectedClients.values()).filter(client => client.status === 'online');

            if (remainingActiveClients.length === 0) {
                await this.telegram?.sendAlert(`⚠️ System Alert
<code>
All clients are now offline
Last Client: ${status.clientId}
Time: ${new Date().toLocaleString()}
</code>`, 'warning');
            }
        }
    }

    private async handleSystemMetrics(metrics: SystemMetrics & { clientId: string }): Promise<void> {
        const client = this.connectedClients.get(metrics.clientId);
        if (!client) return;

        // Update client state
        client.lastHeartbeat = Date.now();
        client.metrics = metrics;

        const memoryUsagePercent = (metrics.memoryUsage / metrics.totalMemory) * 100;
        const baseMetadata = {
            projectName   : client.metadata?.projectName || 'Unknown',
            location     : client.metadata?.location || 'Unknown',
            clientId     : metrics.clientId,
            hostname     : client.metadata?.hostname || os.hostname(),
            version      : client.metadata?.version,
            component    : 'System Monitor'
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
                        loadAverage: os.loadavg(),
                        cpuCount: os.cpus().length,
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
                        loadAverage: os.loadavg(),
                        timestamp: new Date().toLocaleString()
                    }
                }
            });

            client.lastReport = Date.now();
        }

        this.connectedClients.set(metrics.clientId, client);
    }

    private async handleAlert(alert: Alert): Promise<void> {
        const formattedMessage = this.formatAlertMessage(alert);
        await this.telegram?.sendAlert(formattedMessage, alert.severity);
        this.io.emit('alert', alert);
    }

    async publishConnectionStatus(status: ConnectionStatus): Promise<void> {
        try {
            if (!this.connected) {
                throw new Error('Redis publisher not connected')
            }

            await this.publisher.publish(
                CHANNELS.CONNECTION_STATUS
                , JSON.stringify(status)
            );

            logger.info(`Published connection status for client ${status.clientId}`);
        } catch (error) {
            logger.error('Error publishing connection status:', error);
            throw error;
        }
    }

    async publishSystemMetrics(metrics: SystemMetrics): Promise<void> {
        try {
            if (!this.connected) {
                throw new Error('Redis publisher not connected');
            }

            await this.publisher.publish(
                CHANNELS.SYSTEM_METRICS
                , JSON.stringify(metrics)
            );

            logger.debug('Published system metrics');
        } catch (error) {
            logger.error('Error publishing system metrics:', error);
            throw error;
        }
    }

    async publishAlert(alert: Alert): Promise<void> {
        try {
            if (!this.connected) {
                throw new Error('Redis publisher not connected');
            }

            const alertData = {
                ...alert,
                timestamp: alert.timestamp || Date.now()
            };

            await this.publisher.publish(
                CHANNELS.ALERTS,
                JSON.stringify(alertData)
            );

    
            const formattedMessage = this.formatAlertMessage(alertData);
            await this.telegram?.sendAlert(formattedMessage, alert.severity);
            

            this.io.emit('alert', alertData);
            
            logger.info(`Published alert: ${alert.type} for ${alert.metadata.projectName}`);
        } catch (error) {
            logger.error('Error publishing alert:', error);
            throw error;
        }
    }

    private formatAlertMessage(alert: Alert): string {
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

    async shutdown(): Promise<void> {
        logger.info('Publisher service shutting down...');
        await this.telegram?.sendAlert('🔄 Monitoring system shutting down...', 'warning');
        this.io.disconnectSockets();
        await this.subscriber.quit();
        await this.publisher.quit();
        await this.database.shutdown();
        await this.telegram?.shutdown();
        this.connected = false;
        logger.info('Publisher service shut down complete');
    }


    private getLastKnownClientsInfo(): string {
        if (this.connectedClients.size === 0) {
            return 'No clients have connected yet';
        }

        return Array.from(this.connectedClients.entries())
            .map(([clientId, client]) => {
                return `- ${clientId} (${client.status})
  Last Seen: ${new Date(client.lastHeartbeat).toLocaleString()}
  Project: ${client.metadata?.projectName || 'Unknown'}
  Location: ${client.metadata?.location || 'Unknown'}`;
            })
            .join('\n');
    }
}
