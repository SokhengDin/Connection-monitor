import { io, Socket } from 'socket.io-client';
import { SystemMetrics, ClientMetadata, Alert } from '../../types/connection.type';
import { ClientToServerEvents, ServerToClientEvents } from '../../types/socket.types';
import { logger } from '../../utils/logger';

type AlertHandler = (alert: Alert) => void;
type StatusHandler = (status: { connected: boolean; reason?: string }) => void;

export class SocketClient {
    private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
    private reconnectAttempts: number       = 0;
    private reconnectTimer?: NodeJS.Timeout;
    private readonly MAX_RECONNECT_ATTEMPTS = 5;
    private readonly RECONNECT_INTERVAL     = 5000;
    private readonly MAX_RECONNECT_INTERVAL = 30000;
    private alertHandlers: AlertHandler[]   = [];
    private statusHandlers: StatusHandler[] = [];
    private isReconnecting                  = false;

    constructor(
        private readonly clientId: string,
        private readonly metadata: ClientMetadata
    ) {}

    connect(serverUrl: string = 'http://localhost:3000'): void {
        if (this.socket?.connected || this.isReconnecting) return;  

        this.socket = io(serverUrl, {
            auth: { 
                clientId: this.clientId,
                metadata: this.metadata
            },
            reconnection: true,
            reconnectionAttempts: this.MAX_RECONNECT_ATTEMPTS,
            reconnectionDelay: 5000,
            timeout: 10000,
            transports: ['websocket', 'polling']
        });

        this.setupSocketListeners();
    }

    private getReconnectDelay(): number {
        return Math.min(this.RECONNECT_INTERVAL * Math.pow(2, this.reconnectAttempts), this.MAX_RECONNECT_INTERVAL);
    }

    private setupSocketListeners(): void {
        if (!this.socket) return;

        this.socket.on('connect', () => {
            logger.info('Connected to monitoring server');
            this.reconnectAttempts  = 0;
            this.isReconnecting     = false;
            if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
            this.notifyStatusHandlers(true);
            this.sendReconnectionAlert('CLIENT_CONNECTED', 'info');
        });

        this.socket.on('disconnect', (reason) => {
            logger.warn(`Disconnected from server: ${reason}`);
            this.notifyStatusHandlers(false, reason);

            if (reason === 'io server disconnect' || reason === 'transport close') {
                this.socket?.connect();
            }

            this.handleReconnection(reason);
        });

        this.socket.io.on('reconnect_error', (error) => {
            logger.error('Reconnection error:', error);
        });

        this.socket.on('connect_error', (error) => {
            logger.error('Connection error:', error);
            this.notifyStatusHandlers(false, error.message);
            this.handleReconnection(error.message);
        });

        this.socket.io.on('reconnect_failed', () => {
            logger.error('Reconnection failed');
            this.isReconnecting = false;
            this.sendReconnectionAlert('RECONNECTION_FAILED', 'error');
        })

        this.socket.io.on('reconnect_attempt', (attempt) => {
            logger.info(`Reconnection attempt ${attempt}`);
            this.sendReconnectionAlert('RECONNECTING', 'warning');
        })

        this.socket.on('heartbeat:ack', (data) => {
            logger.debug('Received heartbeat acknowledgment:', data);
        });

        this.socket.on('alert', (alert) => {
            logger.warn(`Received alert: ${alert.type} - ${alert.message}`);
            this.notifyAlertHandlers(alert);
        });
    }

    private handleReconnection(reason: string): void {
        if (this.isReconnecting || this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
            return;
        }
    
        this.isReconnecting = true;
        this.reconnectAttempts++;
    
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    
        const delay = this.getReconnectDelay();
        logger.info(`Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay}ms`);
    
        this.reconnectTimer = setTimeout(() => {
            if (!this.socket?.connected) {
                logger.info(`Attempting to reconnect (${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`);
                this.socket?.connect();
            }
        }, delay);
    }

    private sendReconnectionAlert(type: string, severity: Alert['severity']): void {
        this.sendAlert({
            type
            , message: `Client ${type.toLowerCase()} (Attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`
            , severity
            , metadata: {
                ...this.metadata
                , additionalInfo: {
                    reconnectAttempts: this.reconnectAttempts
                    , maxAttempts: this.MAX_RECONNECT_ATTEMPTS
                }
            }
        });
    }

    sendHeartbeat(): void {
        if (!this.socket?.connected) return;
        this.socket.emit('heartbeat', { 
            timestamp: Date.now(),
            metadata: this.metadata 
        });
    }

    sendMetrics(metrics: SystemMetrics): void {
        if (!this.socket?.connected) return;
        this.socket.emit('metrics', {
            ...metrics,
            clientId: this.clientId,
            metadata: this.metadata
        });
    }

    async sendAlert(alert: Omit<Alert, 'timestamp'>): Promise<void> {
        if (!this.socket?.connected) {
            logger.warn('Cannot send alert: not connected to server');
            return;
        }

        try {
            this.socket.emit('alert', {
                ...alert,
                timestamp: Date.now()
            });
        } catch (error) {
            logger.error('Failed to send alert:', error);
            throw error;
        }
    }

    onAlert(handler: AlertHandler): void {
        this.alertHandlers.push(handler);
    }

    onConnectionStatus(handler: StatusHandler): void {
        this.statusHandlers.push(handler);
    }

    private notifyAlertHandlers(alert: Alert): void {
        this.alertHandlers.forEach(handler => {
            try {
                handler(alert);
            } catch (error) {
                logger.error('Error in alert handler:', error);
            }
        });
    }

    private notifyStatusHandlers(connected: boolean, reason?: string): void {
        this.statusHandlers.forEach(handler => {
            try {
                handler({ connected, reason });
            } catch (error) {
                logger.error('Error in status handler:', error);
            }
        });
    }

    removeAlertHandler(handler: AlertHandler): void {
        this.alertHandlers = this.alertHandlers.filter(h => h !== handler);
    }

    removeStatusHandler(handler: StatusHandler): void {
        this.statusHandlers = this.statusHandlers.filter(h => h !== handler);
    }

    disconnect(): void {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        
        this.isReconnecting = false;

        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }

        this.alertHandlers = [];
        this.statusHandlers = [];
    }

    isConnected(): boolean {
        return this.socket?.connected ?? false;
    }

    getClientId(): string {
        return this.clientId;
    }

    getMetadata(): ClientMetadata {
        return this.metadata;
    }
}