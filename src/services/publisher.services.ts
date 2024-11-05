import Redis from "ioredis";
import { CHANNELS } from "../constants/channels";
import { ConnectionStatus, SystemMetrics } from "../types/connection.type";
import { logger } from "../utils/logger";

export class PublisherService {
    private publisher   : Redis;
    private connected   : boolean = false;

    constructor(redisConfig: { host: string; port: number; password?: string }) {
        this.publisher  = new Redis(redisConfig);
        this.setupRedisListeners();
    }

    private setupRedisListeners(): void {
        this.publisher.on('connect', () => {
            this.connected  = true;
            logger.info('Publisher connected to Redis');
        });

        this.publisher.on('error', (error) => {
            this.connected  = false;
            logger.error('Redis connection error:', error);
        });
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
        } catch (error)
        {
            logger.error('Error publishing connection status:', error);
            throw error;
        }
    }

    async publishSystemMetrics(metrics: SystemMetrics): Promise<void> {
        try {
            await this.publisher.publish(
                CHANNELS.SYSTEM_METRICS
                , JSON.stringify(metrics)
            );

            logger.debug('Published system metrics');
        }
        catch (error) {
            logger.error('Error publishing system metrics:', error);
            throw error;
        }
    }

    async publishAlert(alert: {
        type: string
        , message: string
        , severity: 'info' | 'warning' | 'error'
    }): Promise<void> {
        try {
            await this.publisher.publish(
                CHANNELS.ALERTS
                , JSON.stringify({
                    ...alert
                    , timestamp: Date.now()
                })
            );
            logger.info(`Published alert: ${alert.type}`);
        }
        catch (error) {
            logger.error('Error publishing alert:', error);
            throw error;
        }
    }

    async shutdown(): Promise<void> {
        await this.publisher.quit();
        this.connected = false;
    }
}