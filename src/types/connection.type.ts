export interface ConnectionStatus {
    clientId: string;
    status  : 'online' | 'offline' | 'idle';
    timestamp: number;
    metadata?: {
        ip?     : string;
        location?: string;
        hostname?: string;
        socketId?: string;
        reason?  : string;
        lastHeartbeat?: number;
    };
}

export interface SystemMetrics {
    clientId?       : string;
    cpuUsage        : number;
    memoryUsage     : number;
    uptime          : number;
    timestamp       : number;
}
