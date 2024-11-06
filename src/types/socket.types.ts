import { SystemMetrics } from "./connection.type";

export interface ServerToClientEvents {
    'heartbeat:ack': (data: { timestamp: number }) => void;
    'alert': (data: {
        type    : string;
        message : string;
        severity: 'info' | 'warning' | 'error';
        timestamp: number;
    }) => void;
}

export interface ClientToServerEvents {
    heartbeat: () => void;
    metrics: (data: SystemMetrics) => void;
    disconnect: () => void;
}