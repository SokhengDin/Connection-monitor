import { Telegraf } from 'telegraf';
import { logger } from '../utils/logger';
import { SystemMetrics, ClientMetadata } from '../types/connection.type';
import { PublisherService } from './publisher.service';

export class TelegramService {
    private bot: Telegraf;
    private chatId: string;
    private chatClientId: string;

    constructor(token: string, chatId: string, chatClientId: string) {
        this.bot = new Telegraf(token);
        this.chatId = chatId;
        this.chatClientId = chatClientId;
        this.setupBot();
    }

    private setupBot() {
        this.bot.command('status', async (ctx) => {
            if (ctx.chat.id.toString() !== this.chatId) return;
            await ctx.reply('🟢 Monitoring system is active');
        });

        this.bot.command('health', async (ctx) => {
            if (ctx.chat.id.toString() !== this.chatId) return;
        })

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

    async sendKhmerDesktopDownAlert(
        metadata?: Partial<ClientMetadata> & { 
            reason?: string; 
            lastHeartbeat?: number;
        }
    ): Promise<void> {
        const timestamp = new Date().toLocaleString();

        const message = `
🚨 <b>ការជូនដំណឹងអាសន្ន</b>
<code>
កុំព្យូទ័រមានបញ្ហា សូមមេត្តាពិនិត្យមើល!

អតិថិជន: ${metadata?.projectName || 'មិនស្គាល់'}
ទីតាំង: ${metadata?.location || 'មិនស្គាល់'}
ពេលវេលា: ${timestamp}
</code>

<b>សូមពិនិត្យមើលកុំព្យូទ័ររបស់អ្នកជាបន្ទាន់!</b>`;

        try {
            await this.bot.telegram.sendMessage(this.chatClientId, message, {
                parse_mode: 'HTML'
            });
            
            await this.sendAlert(`Desktop down alert sent to client (${metadata?.projectName || 'Unknown'})`, 'error');
        } catch (error) {
            logger.error('Failed to send Khmer desktop down alert:', error);
        }
    }

    async shutdown(): Promise<void> {
        await this.bot.stop();
    }
}