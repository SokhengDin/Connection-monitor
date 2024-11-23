import dotenv from 'dotenv';
import { TelegramService } from './services/telegram.service';
import { logger } from './utils/logger';

dotenv.config();

async function testTelegram() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        logger.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in environment variables');
        process.exit(1);
    }

    const telegram = new TelegramService(token, chatId);

    try {
        await telegram.sendAlert('🔵 Test message from monitoring system', 'info');
        logger.info('Test message sent successfully');
    } catch (error) {
        logger.error('Failed to send test message:', error);
    }
}

testTelegram();