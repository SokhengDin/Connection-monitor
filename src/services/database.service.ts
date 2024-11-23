import mysql from 'mysql2/promise';
import { ClientMetadata } from '../types/connection.type';
import { logger } from '../utils/logger';


interface ConnectionRecord {
    id: number;
    client_id: string;
    project_name: string;
    location: string;
    status: 'online' | 'offline';
    disconnect_reason?: string;
    last_seen: number;
    downtime_duration?: number;
    created_at: Date;
}

export class DatabaseService {
    private pool: mysql.Pool;

    constructor() {
        this.pool   = mysql.createPool({
            host: process.env.DB_HOST || 'localhost'
            , user: process.env.DB_USER || 'root'
            , password: process.env.DB_PASSWORD
            , database: process.env.DB_NAME || 'connection_monitor'
            , waitForConnections: true
            , connectionLimit: 10
        });

        this.initializeDatabase();
    }

    private async initializeDatabase(): Promise<void> {
        try {
            const fs            = require('fs');
            const path          = require('path');
            const migrationSQL  = fs.readFileSync(
                path.join(__dirname, '../migrations/001_create_connections_table.sql'),
                'utf8'
            );
            await this.pool.query(migrationSQL);
            logger.info('Database initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize database:', error);
        }
    }

    async recordConnectionStatus(
        clientId: string,
        status: 'online' | 'offline',
        metadata?: ClientMetadata,
        reason?: string
    ): Promise<void> {
        try {
            const query = `
                INSERT INTO connections 
                (client_id, project_name, location, status, disconnect_reason, last_seen)
                VALUES (?, ?, ?, ?, ?, ?)
            `;

            await this.pool.execute(query, [
                clientId,
                metadata?.projectName || 'Unknown',
                metadata?.location || 'Unknown',
                status,
                reason || null,
                Date.now()
            ]);

            if (status === 'online') {
                await this.updateDowntime(clientId);
            }

            logger.debug(`Recorded ${status} status for client ${clientId}`);
        } catch (error) {
            logger.error('Error recording connection status:', error);
        }
    }

    private async updateDowntime(clientId: string): Promise<void> {
        try {
            const query = `
                UPDATE connections 
                SET downtime_duration = (
                    SELECT TIMESTAMPDIFF(
                        SECOND,
                        created_at,
                        NOW()
                    )
                )
                WHERE client_id = ?
                AND status = 'offline'
                AND downtime_duration IS NULL
                ORDER BY id DESC
                LIMIT 1
            `;

            await this.pool.execute(query, [clientId]);
            logger.debug(`Updated downtime for client ${clientId}`);
        } catch (error) {
            logger.error('Error updating downtime:', error);
        }
    }

    async getLastConnectionStatus(clientId: string): Promise<ConnectionRecord | null> {
        try {
            const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
                'SELECT * FROM connections WHERE client_id = ? ORDER BY id DESC LIMIT 1',
                [clientId]
            );
            return rows[0] as ConnectionRecord || null;
        } catch (error) {
            logger.error('Error getting last connection status:', error);
            return null;
        }
    }

    async getDowntimeStats(clientId: string): Promise<{ totalDowntime: number; lastDowntime: number | null }> {
        try {
            const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(`
                SELECT 
                    SUM(downtime_duration) as total_downtime,
                    MAX(downtime_duration) as last_downtime
                FROM connections 
                WHERE client_id = ? 
                AND status = 'offline' 
                AND downtime_duration IS NOT NULL
            `, [clientId]);

            return {
                totalDowntime: rows[0]?.total_downtime || 0,
                lastDowntime: rows[0]?.last_downtime || null
            };
        } catch (error) {
            logger.error('Error getting downtime stats:', error);
            return { totalDowntime: 0, lastDowntime: null };
        }
    }

    async getConnectionHistory(
        clientId: string,
        limit: number = 10,
        offset: number = 0
    ): Promise<ConnectionRecord[]> {
        try {
            const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
                `SELECT * FROM connections 
                WHERE client_id = ? 
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?`,
                [clientId, limit, offset]
            );
            return rows as ConnectionRecord[];
        } catch (error) {
            logger.error('Error getting connection history:', error);
            return [];
        }
    }

    async getClientStats(clientId: string): Promise<{
        totalConnections: number;
        totalDowntime: number;
        avgDowntime: number;
        lastSeen: Date | null;
    }> {
        try {
            const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(`
                SELECT 
                    COUNT(*) as total_connections,
                    SUM(downtime_duration) as total_downtime,
                    AVG(downtime_duration) as avg_downtime,
                    MAX(created_at) as last_seen
                FROM connections 
                WHERE client_id = ?
            `, [clientId]);

            return {
                totalConnections: rows[0]?.total_connections || 0,
                totalDowntime: rows[0]?.total_downtime || 0,
                avgDowntime: rows[0]?.avg_downtime || 0,
                lastSeen: rows[0]?.last_seen || null
            };
        } catch (error) {
            logger.error('Error getting client stats:', error);
            return {
                totalConnections: 0,
                totalDowntime: 0,
                avgDowntime: 0,
                lastSeen: null
            };
        }
    }

    async shutdown(): Promise<void> {
        try {
            await this.pool.end();
            logger.info('Database connection closed');
        } catch (error) {
            logger.error('Error shutting down database connection:', error);
        }
    }
}