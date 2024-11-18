import { app, BrowserWindow } from 'electron';
import path from 'path';
import { SocketClient } from '../services/socket.client';
import { MetricsClient } from '../services/metrics.client';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

class MainProcess {
    private window: BrowserWindow | null = null;
    private socketClient: SocketClient;
    private metricsClient: MetricsClient;
    private readonly clientId: string;


    constructor() {
        this.clientId = uuidv4();
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
            width: 800
            , height: 600
            , webPreferences: {
                nodeIntegration: true
                , contextIsolation: false
            }
        });

        this.window.loadFile(path.join(__dirname, '../renderer/index.html'));

        if (process.env.NODE_ENV == 'development') {
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

        // Start heartbeat
        setInterval(() => {
            this.socketClient.sendHeartbeat();
        }, 15000);
    }

    shutdown() {
        this.metricsClient.stopCollecting();
        this.socketClient.disconnect();
    }
}

// Init

const mainProcess   = new MainProcess();

app.on('ready', () => {
    mainProcess.start().catch((error) => {
        logger.error('Error starting application', error)
    });
});

app.on('window-all-closed', () =>{
    if (process.platform !== 'darwin') {
        app.quit();
    };
});

app.on('before-quit', () => {
    mainProcess.shutdown();
});