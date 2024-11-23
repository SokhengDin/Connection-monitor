import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

dotenv.config();

async function initializeDatabase() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD,
    });

    try {
        await connection.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`);
        await connection.query(`USE ${process.env.DB_NAME}`);

        const migrationPath     = path.join(__dirname, '../migrations');
        const migrationFiles    = fs.readdirSync(migrationPath)
            .filter(file => file.endsWith('.sql'))
            .sort();

        for (const file of migrationFiles) {
            const migration     = fs.readFileSync(path.join(migrationPath, file), 'utf8');
            await connection.query(migration);
            logger.info(`Executed migration: ${file}`);
        }

        logger.info('Database initialization complete');
    } catch (error) {
        logger.error('Database initialization failed:', error);
        throw error;
    } finally {
        await connection.end();
    }
}

if (require.main === module) {
    initializeDatabase()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

export { initializeDatabase };