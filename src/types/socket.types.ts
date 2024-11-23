import { SystemMetrics, ClientMetadata, Alert } from "./connection.type";

export interface ServerToClientEvents {
    'heartbeat:ack': (data: { timestamp: number }) => void;
    'alert': (data: Alert) => void;
}

export interface ClientToServerEvents {
    heartbeat: (data: { metadata: ClientMetadata; timestamp: number }) => void;
    metrics: (data: SystemMetrics & { metadata: ClientMetadata }) => void;
    disconnect: () => void;
    alert: (data: Alert) => void;
}