import { Telegraf } from 'telegraf';
import { logger } from '../utils/logger';
import { SystemMetrics, ClientMetadata } from '../types/connection.type';

export class TelegramService {
    private bot: Telegraf;
    private chatId: string;

    constructor(token: string, chatId: string) {
        this.bot = new Telegraf(token);
        this.chatId = chatId;
        this.setupBot();
    }

    private setupBot() {
        this.bot.command('status', async (ctx) => {
            if (ctx.chat.id.toString() !== this.chatId) return;
            await ctx.reply('🟢 Monitoring system is active');
        });

        this.bot.launch().catch(err => {
            logger.error('Failed to launch Telegram bot:', err);
        });
    }

    async sendAlert(message: string, severity: 'info' | 'warning' | 'error' = 'info'): Promise<void> {
        try {
            const emoji = {
                info: 'ℹ️',
                warning: '⚠️',
                error: '🚨'
            }[severity];

            await this.bot.telegram.sendMessage(this.chatId, `${emoji} ${message}`, {
                parse_mode: 'HTML'
            });
        } catch (error) {
            logger.error('Failed to send Telegram alert:', error);
        }
    }

    async sendClientStatus(
        clientId: string, 
        status: 'online' | 'offline', 
        metadata: ClientMetadata,
        metrics?: SystemMetrics
    ): Promise<void> {
        const emoji = status === 'online' ? '🟢' : '🔴';
        const timestamp = new Date().toLocaleString();

        let message = `
${emoji} <b>Client Status Update</b>
<code>
Client ID: ${clientId}
Status: ${status.toUpperCase()}
Time: ${timestamp}

Project: ${metadata.projectName}
Location: ${metadata.location}
Owner: ${metadata.owner}
Installed: ${metadata.installedDate}
</code>`;

        if (metrics) {
            message += `\n<code>
System Metrics:
CPU Usage: ${metrics.cpuUsage.toFixed(2)}%
Memory: ${(metrics.memoryUsage / (1024 * 1024)).toFixed(2)} MB
Uptime: ${(metrics.uptime / 3600).toFixed(2)} hours
</code>`;
        }

        await this.sendAlert(message, status === 'online' ? 'info' : 'warning');
    }

    async sendHealthReport(
        clientId: string,
        metadata: ClientMetadata,
        metrics: SystemMetrics
    ): Promise<void> {
        const message = `
📊 <b>Health Report</b>
<code>
Client: ${clientId}
Project: ${metadata.projectName}
Location: ${metadata.location}

System Metrics:
CPU Usage: ${metrics.cpuUsage.toFixed(2)}%
Memory Used: ${(metrics.memoryUsage / (1024 * 1024)).toFixed(2)} MB
Memory Total: ${(metrics.totalMemory / (1024 * 1024 * 1024)).toFixed(2)} GB
Uptime: ${(metrics.uptime / 3600).toFixed(2)} hours

Report Time: ${new Date().toLocaleString()}
</code>`;

        await this.sendAlert(message, 'info');
    }

    async shutdown(): Promise<void> {
        await this.bot.stop();
    }
}