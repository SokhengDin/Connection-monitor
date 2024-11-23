import { io, Socket } from 'socket.io-client';
import { SystemMetrics, ClientMetadata } from '../../types/connection.type';
import { ClientToServerEvents, ServerToClientEvents } from '../../types/socket.types';
import { logger } from '../../utils/logger';

export class SocketClient {
    private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
    private reconnectAttempts: number = 0;
    private readonly MAX_RECONNECT_ATTEMPTS = 5;

    constructor(
        private readonly clientId: string,
        private readonly metadata: ClientMetadata
    ) {}

    connect(serverUrl: string = 'http://localhost:3000'): void {
        this.socket = io(serverUrl, {
            auth: { 
                clientId: this.clientId,
                metadata: this.metadata
            },
            reconnection: true,
            reconnectionAttempts: this.MAX_RECONNECT_ATTEMPTS,
            reconnectionDelay: 5000,
            timeout: 10000
        });

        this.setupSocketListeners();
    }

    private setupSocketListeners(): void {
        if (!this.socket) return;

        this.socket.on('connect', () => {
            logger.info('Connected to monitoring server');
            this.reconnectAttempts = 0;
        });

        this.socket.on('disconnect', (reason) => {
            logger.warn(`Disconnected from server: ${reason}`);
        });

        this.socket.on('connect_error', (error) => {
            logger.error('Connection error:', error);
            this.reconnectAttempts++;

            if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
                logger.error('Max reconnection attempts reached');
                this.socket?.disconnect();
            }
        });

        this.socket.on('heartbeat:ack', (data) => {
            logger.debug('Received heartbeat acknowledgment:', data);
        });

        this.socket.on('alert', (alert) => {
            logger.warn(`Received alert: ${alert.type} - ${alert.message}`);
        });
    }

    sendHeartbeat(): void {
        if (!this.socket?.connected) return;
        this.socket.emit('heartbeat', { metadata: this.metadata });
    }

    sendMetrics(metrics: SystemMetrics): void {
        if (!this.socket?.connected) return;
        this.socket.emit('metrics', {
            ...metrics,
            clientId: this.clientId,
            metadata: this.metadata
        });
    }

    disconnect(): void {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }

    isConnected(): boolean {
        return this.socket?.connected ?? false;
    }
}