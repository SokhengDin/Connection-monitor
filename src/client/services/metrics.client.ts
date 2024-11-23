import os from 'os';
import { SystemMetrics } from '../../types/connection.type';
import { logger } from '../../utils/logger';

export class MetricsClient {
    private interval: NodeJS.Timeout | null = null;

    collectMetrics(): SystemMetrics {
        const totalMemory  = os.totalmem();
        const freeMemory   = os.freemem();
        const usedMemory   = totalMemory - freeMemory;


        return {
            cpuUsage        : os.loadavg()[0]
            , memoryUsage   : process.memoryUsage().heapUsed
            , totalMemory   : totalMemory
            , freeMemory    : freeMemory
            , uptime        : process.uptime()
            , timestamp     : Date.now()
        };
    }


    startCollecting(callback: (metrics: SystemMetrics) => void, intervalMs: number = 30000) {
        this.interval       = setInterval(() => {
            try {
                const metrics   = this.collectMetrics();
                callback(metrics);
            }
            catch (error ) {
                logger.error('Error collecting metrics:', error);
            }
        }, intervalMs);


        try {
            callback(this.collectMetrics());
        }
        catch (error) {
            logger.error('Error collecting initial metrics:', error);
        }
    } 

    stopCollecting() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
}