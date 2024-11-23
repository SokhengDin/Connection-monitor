CREATE TABLE IF NOT EXISTS connections (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    client_id VARCHAR(255) NOT NULL,
    project_name VARCHAR(255),
    location VARCHAR(255),
    status ENUM('online', 'offline') NOT NULL,
    disconnect_reason VARCHAR(255),
    last_seen BIGINT NOT NULL,
    downtime_duration BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_client_id (client_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
);