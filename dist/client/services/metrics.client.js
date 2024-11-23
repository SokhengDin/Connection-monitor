"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsClient = void 0;
const os_1 = __importDefault(require("os"));
const logger_1 = require("../../utils/logger");
class MetricsClient {
    constructor() {
        this.interval = null;
    }
    collectMetrics() {
        const totalMemory = os_1.default.totalmem();
        const freeMemory = os_1.default.freemem();
        const usedMemory = totalMemory - freeMemory;
        return {
            cpuUsage: os_1.default.loadavg()[0],
            memoryUsage: process.memoryUsage().heapUsed,
            totalMemory: totalMemory,
            freeMemory: freeMemory,
            uptime: process.uptime(),
            timestamp: Date.now()
        };
    }
    startCollecting(callback, intervalMs = 30000) {
        this.interval = setInterval(() => {
            try {
                const metrics = this.collectMetrics();
                callback(metrics);
            }
            catch (error) {
                logger_1.logger.error('Error collecting metrics:', error);
            }
        }, intervalMs);
        try {
            callback(this.collectMetrics());
        }
        catch (error) {
            logger_1.logger.error('Error collecting initial metrics:', error);
        }
    }
    stopCollecting() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
}
exports.MetricsClient = MetricsClient;
//# sourceMappingURL=metrics.client.js.map