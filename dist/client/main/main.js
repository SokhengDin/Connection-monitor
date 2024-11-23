"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const uuid_1 = require("uuid");
const socket_client_1 = require("../services/socket.client");
const metrics_client_1 = require("../services/metrics.client");
const logger_1 = require("../../utils/logger");
dotenv_1.default.config();
class MainProcess {
    constructor() {
        this.window = null;
        this.heartbeatInterval = null;
        this.HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL || '15000');
        this.METRICS_INTERVAL = parseInt(process.env.METRICS_INTERVAL || '30000');
        this.clientId = process.env.CLIENT_ID || (0, uuid_1.v4)();
        this.metadata = {
            projectName: process.env.PROJECT_NAME || 'Unknown Project',
            location: process.env.LOCATION || 'Unknown Location',
            installedDate: process.env.INSTALLED_DATE || new Date().toISOString(),
            owner: process.env.OWNER || 'Unknown Owner',
            hostname: os_1.default.hostname(),
            version: process.env.npm_package_version || '1.0.0'
        };
        this.socketClient = new socket_client_1.SocketClient(this.clientId, this.metadata);
        this.metricsClient = new metrics_client_1.MetricsClient();
    }
    setupIPC() {
        electron_1.ipcMain.handle('get-client-info', () => ({
            clientId: this.clientId,
            metadata: this.metadata
        }));
        electron_1.ipcMain.on('send-alert', (_, alert) => {
            this.socketClient.sendAlert({
                ...alert,
                metadata: this.metadata
            });
        });
    }
    async start() {
        await electron_1.app.whenReady();
        this.createWindow();
        this.setupServices();
        logger_1.logger.info(`Starting client: ${this.clientId}`, { metadata: this.metadata });
    }
    createWindow() {
        this.window = new electron_1.BrowserWindow({
            width: 800,
            height: 600,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            },
            title: `Monitor - ${this.metadata.projectName} (${this.metadata.location})`
        });
        this.window.loadFile(path_1.default.join(__dirname, '../renderer/index.html'));
        if (process.env.NODE_ENV === 'development') {
            this.window.webContents.openDevTools();
        }
        this.window.on('closed', () => {
            this.window = null;
        });
    }
    setupServices() {
        this.socketClient.connect(process.env.SERVER_URL);
        this.metricsClient.startCollecting((metrics) => {
            var _a;
            this.socketClient.sendMetrics({
                ...metrics,
                clientId: this.clientId
            });
            (_a = this.window) === null || _a === void 0 ? void 0 : _a.webContents.send('metrics-update', {
                ...metrics,
                clientId: this.clientId,
                metadata: this.metadata
            });
        }, this.METRICS_INTERVAL);
        this.heartbeatInterval = setInterval(() => {
            this.socketClient.sendHeartbeat();
        }, this.HEARTBEAT_INTERVAL);
        this.socketClient.onAlert((alert) => {
            var _a;
            (_a = this.window) === null || _a === void 0 ? void 0 : _a.webContents.send('alert', alert);
        });
        this.socketClient.onConnectionStatus((status) => {
            var _a;
            (_a = this.window) === null || _a === void 0 ? void 0 : _a.webContents.send('connection-status', status);
        });
    }
    async shutdown() {
        logger_1.logger.info(`Shutting down client: ${this.clientId}`);
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        this.metricsClient.stopCollecting();
        await this.socketClient.sendAlert({
            type: 'CLIENT_SHUTDOWN',
            message: 'Client shutting down gracefully',
            severity: 'info',
            metadata: this.metadata
        });
        this.socketClient.disconnect();
    }
}
function initialize() {
    const mainProcess = new MainProcess();
    electron_1.app.on('ready', () => {
        mainProcess.start().catch((error) => {
            logger_1.logger.error('Error starting application:', error);
        });
    });
    electron_1.app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            electron_1.app.quit();
        }
    });
    electron_1.app.on('before-quit', () => {
        mainProcess.shutdown();
    });
    process.on('uncaughtException', (error) => {
        logger_1.logger.error('Uncaught exception:', error);
    });
    process.on('unhandledRejection', (reason, p) => {
        logger_1.logger.error('Unhandled Rejection at:', p, 'reason:', reason);
    });
}
initialize();
//# sourceMappingURL=main.js.map