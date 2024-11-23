import dotenv from 'dotenv';
import { SocketClient } from './client/services/socket.client';
import { MetricsClient } from './client/services/metrics.client';
import { logger } from './utils/logger';
import { ClientMetadata } from './types/connection.type';
import os from 'os';

dotenv.config();

const clientMetadata: ClientMetadata = {
    projectName   : process.env.PROJECT_NAME || 'Test Project',
    location      : process.env.LOCATION || 'Local Development',
    installedDate : process.env.INSTALLED_DATE || new Date().toISOString(),
    owner         : process.env.OWNER || 'Development Team',
    hostname      : os.hostname(),
    version       : process.env.npm_package_version || '1.0.0'
};

async function main() {
    const clientId = process.env.CLIENT_ID || 'test-mac-client';
    const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';

    logger.info(`Starting test client (${clientId})`);
    logger.info(`Connecting to server: ${serverUrl}`);

    const socketClient = new SocketClient(clientId, clientMetadata);
    const metricsClient = new MetricsClient();

    socketClient.connect(serverUrl);

    metricsClient.startCollecting((metrics) => {
        socketClient.sendMetrics(metrics);
        logger.debug('Metrics sent:', metrics);
    }, parseInt(process.env.METRICS_INTERVAL || '30000')); 


    const heartbeatInterval = setInterval(() => {
        socketClient.sendHeartbeat();
        logger.debug('Heartbeat sent');
    }, parseInt(process.env.HEARTBEAT_INTERVAL || '15000'));

    process.on('SIGINT', () => {
        logger.info('Shutting down client...');
        clearInterval(heartbeatInterval);
        metricsClient.stopCollecting();
        socketClient.disconnect();
        process.exit(0);
    });
}

main().catch((error) => {
    logger.error('Error in test client:', error);
    process.exit(1);
});