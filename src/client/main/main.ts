import dotenv from 'dotenv';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { SocketClient } from '../services/socket.client';
import { MetricsClient } from '../services/metrics.client';
import { ClientMetadata } from '../../types/connection.type';
import { logger } from '../../utils/logger';

// Only import Electron in development
let electron: typeof import('electron') | null = null;
if (process.env.NODE_ENV !== 'production') {
    electron = require('electron');
}

dotenv.config();

class MainProcess {
    private window: any = null;
    private socketClient: SocketClient;
    private metricsClient: MetricsClient;
    private readonly clientId: string;
    private readonly metadata: ClientMetadata;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private readonly HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL || '15000');
    private readonly METRICS_INTERVAL = parseInt(process.env.METRICS_INTERVAL || '30000');
    private isHeadless: boolean;

    constructor() {
        this.clientId = process.env.CLIENT_ID || uuidv4();
        this.metadata = {
            projectName: process.env.PROJECT_NAME || 'Unknown Project',
            location: process.env.LOCATION || 'Unknown Location',
            installedDate: process.env.INSTALLED_DATE || new Date().toISOString(),
            owner: process.env.OWNER || 'Unknown Owner',
            hostname: os.hostname(),
            version: process.env.npm_package_version || '1.0.0'
        };

        this.socketClient = new SocketClient(this.clientId, this.metadata);
        this.metricsClient = new MetricsClient();
        this.isHeadless = process.env.NODE_ENV === 'production';
    }

    async start() {
        if (this.isHeadless) {
            await this.startHeadless();
        } else {
            await this.startElectron();
        }
    }

    private async startHeadless() {
        logger.info(`Starting headless client: ${this.clientId}`, { metadata: this.metadata });
        this.setupServices();
    }

    private async startElectron() {
        if (!electron) return;
        const { app, BrowserWindow } = electron;
        
        await app.whenReady();
        this.createWindow(BrowserWindow);
        this.setupServices();
        this.setupIPC();
    }

    private setupIPC() {
        if (!electron || this.isHeadless) return;
        const { ipcMain } = electron;

        ipcMain.handle('get-client-info', () => ({
            clientId: this.clientId,
            metadata: this.metadata
        }));

        ipcMain.on('send-alert', (_, alert) => {
            this.socketClient.sendAlert({
                ...alert,
                metadata: this.metadata
            });
        });
    }

    private createWindow(BrowserWindow: any) {
        if (this.isHeadless) return;

        this.window = new BrowserWindow({
            width: 800,
            height: 600,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            },
            title: `Monitor - ${this.metadata.projectName} (${this.metadata.location})`
        });

        this.window.loadFile(require('path').join(__dirname, '../renderer/index.html'));

        if (process.env.NODE_ENV === 'development') {
            this.window.webContents.openDevTools();
        }

        this.window.on('closed', () => {
            this.window = null;
        });
    }

    private setupServices() {
        this.socketClient.connect(process.env.SERVER_URL);

        this.metricsClient.startCollecting((metrics) => {
            this.socketClient.sendMetrics({
                ...metrics,
                clientId: this.clientId
            });
            
            if (!this.isHeadless && this.window) {
                this.window.webContents.send('metrics-update', {
                    ...metrics,
                    clientId: this.clientId,
                    metadata: this.metadata
                });
            }
        }, this.METRICS_INTERVAL);

        this.heartbeatInterval = setInterval(() => {
            this.socketClient.sendHeartbeat();
        }, this.HEARTBEAT_INTERVAL);

        this.socketClient.onAlert((alert) => {
            if (!this.isHeadless && this.window) {
                this.window.webContents.send('alert', alert);
            }
        });

        this.socketClient.onConnectionStatus((status) => {
            if (!this.isHeadless && this.window) {
                this.window.webContents.send('connection-status', status);
            }
        });
    }

    async shutdown() {
        logger.info(`Shutting down client: ${this.clientId}`);
        
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

// Different initialization based on environment
if (process.env.NODE_ENV === 'production') {
    const mainProcess = new MainProcess();
    mainProcess.start().catch((error) => {
        logger.error('Error starting application:', error);
        process.exit(1);
    });

    // Handle shutdown in production
    ['SIGINT', 'SIGTERM'].forEach(signal => {
        process.on(signal, async () => {
            logger.info(`Received ${signal}`);
            const mainProcess = new MainProcess();
            await mainProcess.shutdown();
            process.exit(0);
        });
    });
} else {
    // Development with Electron
    function initialize() {
        const mainProcess = new MainProcess();
        const { app } = electron!;

        app.on('ready', () => {
            mainProcess.start().catch((error) => {
                logger.error('Error starting application:', error);
            });
        });
        
        app.on('window-all-closed', () => {
            if (process.platform !== 'darwin') {
                app.quit();
            }
        });
        
        app.on('before-quit', () => {
            mainProcess.shutdown();
        });
    }

    initialize();
}

// Global error handlers
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, p) => {
    logger.error('Unhandled Rejection at:', p, 'reason:', reason);
});