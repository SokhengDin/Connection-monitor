import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { SocketClient } from '../services/socket.client';
import { MetricsClient } from '../services/metrics.client';
import { logger } from '../../utils/logger';

dotenv.config();

class MainProcess {
    private window: BrowserWindow | null = null;
    private socketClient: SocketClient;
    private metricsClient: MetricsClient;
    private readonly clientId: string;
    private heartbeatInterval: NodeJS.Timeout | null = null;

    constructor() {
        this.clientId = process.env.CLIENT_ID || uuidv4();
        this.socketClient = new SocketClient(this.clientId);
        this.metricsClient = new MetricsClient();
    }

    async start() {
        await app.whenReady();
        this.createWindow();
        this.setupServices();
    }

    private createWindow() {
        this.window = new BrowserWindow({
            width       : 800
            , height   : 600
            , webPreferences: {
                nodeIntegration    : true
                , contextIsolation : false
            }
        });

        this.window.loadFile(path.join(__dirname, '../renderer/index.html'));

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
            this.socketClient.sendMetrics(metrics);
            this.window?.webContents.send('metrics-update', metrics);
        });


        this.heartbeatInterval = setInterval(() => {
            this.socketClient.sendHeartbeat();
        }, 15000); 
    }

    shutdown() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        this.metricsClient.stopCollecting();
        this.socketClient.disconnect();
    }
}

const mainProcess = new MainProcess();

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

process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, p) => {
    logger.error('Unhandled Rejection at:', p, 'reason:', reason);
});