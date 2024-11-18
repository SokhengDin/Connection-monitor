import { io, Socket } from 'socket.io-client';
import { logger } from '../../utils/logger';
import { ConnectionStatus, SystemMetrics } from '../../types/connection.type';
import { ClientToServerEvents, ServerToClientEvents } from '../../types/socket.types';


export class SocketClient {
    private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
    private clientId: string;
    private reconnectAttempts: number = 0;
    private readonly maxReconnectAttemps = 3;

    constructor(clientId: string) {
        this.clientId   = clientId;
    }

    connect(serverUrl: string = 'http://localhost:3000') {
        this.socket     = io(serverUrl, {
            auth: { clientId: this.clientId }
            , reconnection: true
            , reconnectionAttempts: this.maxReconnectAttemps
            , reconnectionDelay: 1000,
        });

        this.setupSocketListeners();
    }

    private setupSocketListeners() {
        if (!this.socket) return;

        this.socket.on('connect', () => {
            logger.info('Connected to server');
            this.reconnectAttempts  = 0;
            this.socket?.emit('heartbeat');
        });

        this.socket.on('disconnect', () => {
            logger.info('Disconnected from server');
        })
    }

    sendHeartbeat() {
        if (this.socket?.connected) {
            this.socket.emit('heartbeat');
        }
    }

    sendMetrics(metrics: SystemMetrics) {
        if (this.socket?.connected) {
            this.socket.emit('metrics', metrics);
        }
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }

    isConnected(): boolean {
        return this.socket?.connected ?? false;
    }
}