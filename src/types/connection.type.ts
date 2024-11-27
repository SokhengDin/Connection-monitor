export interface ClientMetadata {
    projectName    : string;
    location      : string;
    installedDate : string;
    owner?         : string;
    hostname?     : string;
    ip?           : string;
    version?      : string;
}

export interface ConnectionStatus {
    clientId     : string;
    status       : 'online' | 'offline' | 'idle';
    timestamp    : number;
    metadata?    : Partial<ClientMetadata> & {
        reason?         : string;
        lastHeartbeat?  : number;
    };
}

export interface SystemMetrics {
    clientId?        : string;
    cpuUsage        : number;
    memoryUsage     : number;
    totalMemory     : number;
    freeMemory      : number;
    uptime          : number;
    timestamp       : number;
}

export interface AlertMetadata {
    projectName    : string;
    location      : string;
    component?    : string;
    hostname?     : string;
    ip?           : string;
    version?      : string;
    clientId?     : string;
    additionalInfo?: Record<string, any>;
}

export interface Alert {
    type        : string;
    message     : string;
    severity    : 'info' | 'warning' | 'error';
    timestamp?  : number;
    metadata    : AlertMetadata;
}

export interface AlertResponse {
    success     : boolean;
    error?      : string;
    timestamp   : number;
    metadata?   : AlertMetadata;
}