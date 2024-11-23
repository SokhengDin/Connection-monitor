"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramService = void 0;
const telegraf_1 = require("telegraf");
const logger_1 = require("../utils/logger");
class TelegramService {
    constructor(token, chatId) {
        this.bot = new telegraf_1.Telegraf(token);
        this.chatId = chatId;
        this.setupBot();
    }
    setupBot() {
        this.bot.command('status', async (ctx) => {
            if (ctx.chat.id.toString() !== this.chatId)
                return;
            await ctx.reply('🟢 Monitoring system is active');
        });
        this.bot.launch().catch(err => {
            logger_1.logger.error('Failed to launch Telegram bot:', err);
        });
    }
    async sendAlert(message, severity = 'info') {
        try {
            const emoji = {
                info: 'ℹ️',
                warning: '⚠️',
                error: '🚨'
            }[severity];
            await this.bot.telegram.sendMessage(this.chatId, `${emoji} ${message}`, {
                parse_mode: 'HTML'
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to send Telegram alert:', error);
        }
    }
    async sendClientStatus(clientId, status, metadata, metrics) {
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
    async sendHealthReport(clientId, metadata, metrics) {
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
    async shutdown() {
        await this.bot.stop();
    }
}
exports.TelegramService = TelegramService;
