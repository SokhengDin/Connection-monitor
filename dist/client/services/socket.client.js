"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketClient = void 0;
const socket_io_client_1 = require("socket.io-client");
const logger_1 = require("../../utils/logger");
class SocketClient {
    constructor(clientId, metadata) {
        this.clientId = clientId;
        this.metadata = metadata;
        this.socket = null;
        this.reconnectAttempts = 0;
        this.MAX_RECONNECT_ATTEMPTS = 5;
        this.alertHandlers = [];
        this.statusHandlers = [];
    }
    connect(serverUrl = 'http://localhost:3000') {
        this.socket = (0, socket_io_client_1.io)(serverUrl, {
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
    setupSocketListeners() {
        if (!this.socket)
            return;
        this.socket.on('connect', () => {
            logger_1.logger.info('Connected to monitoring server');
            this.reconnectAttempts = 0;
            this.notifyStatusHandlers(true);
            this.sendAlert({
                type: 'CLIENT_CONNECTED',
                message: 'Client connected to server',
                severity: 'info',
                metadata: this.metadata
            });
        });
        this.socket.on('disconnect', (reason) => {
            logger_1.logger.warn(`Disconnected from server: ${reason}`);
            this.notifyStatusHandlers(false, reason);
            if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
                this.sendAlert({
                    type: 'CLIENT_DISCONNECTED',
                    message: `Client disconnected: ${reason}`,
                    severity: 'warning',
                    metadata: this.metadata
                });
            }
        });
        this.socket.on('connect_error', (error) => {
            var _a;
            logger_1.logger.error('Connection error:', error);
            this.reconnectAttempts++;
            this.notifyStatusHandlers(false, error.message);
            if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
                logger_1.logger.error('Max reconnection attempts reached');
                this.sendAlert({
                    type: 'CONNECTION_FAILED',
                    message: 'Max reconnection attempts reached',
                    severity: 'error',
                    metadata: this.metadata
                });
                (_a = this.socket) === null || _a === void 0 ? void 0 : _a.disconnect();
            }
        });
        this.socket.on('heartbeat:ack', (data) => {
            logger_1.logger.debug('Received heartbeat acknowledgment:', data);
        });
        this.socket.on('alert', (alert) => {
            logger_1.logger.warn(`Received alert: ${alert.type} - ${alert.message}`);
            this.notifyAlertHandlers(alert);
        });
    }
    sendHeartbeat() {
        var _a;
        if (!((_a = this.socket) === null || _a === void 0 ? void 0 : _a.connected))
            return;
        this.socket.emit('heartbeat', {
            timestamp: Date.now(),
            metadata: this.metadata
        });
    }
    sendMetrics(metrics) {
        var _a;
        if (!((_a = this.socket) === null || _a === void 0 ? void 0 : _a.connected))
            return;
        this.socket.emit('metrics', {
            ...metrics,
            clientId: this.clientId,
            metadata: this.metadata
        });
    }
    async sendAlert(alert) {
        var _a;
        if (!((_a = this.socket) === null || _a === void 0 ? void 0 : _a.connected)) {
            logger_1.logger.warn('Cannot send alert: not connected to server');
            return;
        }
        try {
            this.socket.emit('alert', {
                ...alert,
                timestamp: Date.now()
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to send alert:', error);
            throw error;
        }
    }
    onAlert(handler) {
        this.alertHandlers.push(handler);
    }
    onConnectionStatus(handler) {
        this.statusHandlers.push(handler);
    }
    notifyAlertHandlers(alert) {
        this.alertHandlers.forEach(handler => {
            try {
                handler(alert);
            }
            catch (error) {
                logger_1.logger.error('Error in alert handler:', error);
            }
        });
    }
    notifyStatusHandlers(connected, reason) {
        this.statusHandlers.forEach(handler => {
            try {
                handler({ connected, reason });
            }
            catch (error) {
                logger_1.logger.error('Error in status handler:', error);
            }
        });
    }
    removeAlertHandler(handler) {
        this.alertHandlers = this.alertHandlers.filter(h => h !== handler);
    }
    removeStatusHandler(handler) {
        this.statusHandlers = this.statusHandlers.filter(h => h !== handler);
    }
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.alertHandlers = [];
        this.statusHandlers = [];
    }
    isConnected() {
        var _a, _b;
        return (_b = (_a = this.socket) === null || _a === void 0 ? void 0 : _a.connected) !== null && _b !== void 0 ? _b : false;
    }
    getClientId() {
        return this.clientId;
    }
    getMetadata() {
        return this.metadata;
    }
}
exports.SocketClient = SocketClient;
//# sourceMappingURL=socket.client.js.map