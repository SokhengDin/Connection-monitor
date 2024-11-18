import { ipcRenderer } from "electron";
import { SystemMetrics } from "../../types/connection.type";

class ClientUI {
    private statusElement: HTMLElement;
    private metricsElement: HTMLElement;

    constructor() {
        this.statusElement  = document.getElementById('status')!;
        this.metricsElement = document.getElementById('metrics')!;
        this.setupListeners();
    }

    private setupListeners() {
        ipcRenderer.on('connection-status', (_, status: string) => {
            this.updateStatus(status);
        })

        ipcRenderer.on('metrics-update', (_, metrics: SystemMetrics) => {
            this.updateMetrics(metrics);
        });
    }

    private updateStatus(status: string) {
        this.statusElement.className = `status-card ${status}`;
        this.statusElement.innerHTML = `
            <span>Status: ${status}</span>
            <span>${new Date().toLocaleTimeString()}</span>
        `;
    }

    private updateMetrics(metrics: SystemMetrics) {
        const metricsHtml = `
            <div class="metric-item">
                <span>CPU Usage:</span>
                <span>${metrics.cpuUsage.toFixed(2)}%</span>
            </div>
            <div class="metric-item">
                <span>Memory Usage:</span>
                <span>${(metrics.memoryUsage / 1024 / 1024).toFixed(2)} MB</span>
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
    }
}

new ClientUI();