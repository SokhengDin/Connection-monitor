"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
class ClientUI {
    constructor() {
        this.statusElement = document.getElementById('status');
        this.metricsElement = document.getElementById('metrics');
        this.setupListeners();
    }
    setupListeners() {
        electron_1.ipcRenderer.on('metrics-update', (_, metrics) => {
            this.updateMetrics(metrics);
        });
    }
    updateMetrics(metrics) {
        const memoryUsagePercent = (metrics.memoryUsage / metrics.totalMemory) * 100;
        const metricsHtml = `
            <div class="metric-item">
                <span>CPU Usage:</span>
                <span>${metrics.cpuUsage.toFixed(2)}%</span>
            </div>
            <div class="metric-item">
                <span>Memory Usage:</span>
                <span>${(metrics.memoryUsage / (1024 * 1024)).toFixed(2)} MB (${memoryUsagePercent.toFixed(2)}%)</span>
            </div>
            <div class="metric-item">
                <span>Total Memory:</span>
                <span>${(metrics.totalMemory / (1024 * 1024 * 1024)).toFixed(2)} GB</span>
            </div>
            <div class="metric-item">
                <span>Uptime:</span>
                <span>${(metrics.uptime / 60).toFixed(2)} minutes</span>
            </div>
            <div class="metric-item">
                <span>Last Update:</span>
                <span>${new Date(metrics.timestamp).toLocaleTimeString()}</span>
            </div>
        `;
        this.metricsElement.innerHTML = metricsHtml;
        if (memoryUsagePercent > 90 || metrics.cpuUsage > 80) {
            this.metricsElement.classList.add('warning');
        }
        else {
            this.metricsElement.classList.remove('warning');
        }
    }
}
// Initialize UI
new ClientUI();
//# sourceMappingURL=app.js.map