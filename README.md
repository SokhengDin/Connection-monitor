# Connection Monitor

A real-time system monitoring tool built with Node.js, Socket.IO, and Redis for tracking server health and status across multiple clients. Includes Telegram notifications for instant alerts.

## Features

- 🔄 Real-time connection monitoring
- 📊 System metrics tracking (CPU, Memory, Uptime)
- 🚨 Instant Telegram alerts for critical events
- 💾 Redis pub/sub for scalable event handling
- ⚡ Socket.IO for real-time communication
- 📱 Desktop client with Electron
- 🔍 Detailed system health reports

## Prerequisites

- Node.js >= 16
- Redis Server
- Telegram Bot Token (for notifications)
- Docker (optional, for Redis)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/connection-monitor.git
cd connection-monitor
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:

Create a `.env` file in the project root:
```bash
# Server Configuration
PORT=3000
NODE_ENV=development

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password    # Optional

# Telegram Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id

# Monitoring Settings
HEARTBEAT_INTERVAL=15000       # 15 seconds
HEALTH_CHECK_INTERVAL=30000    # 30 seconds
OFFLINE_THRESHOLD=60000        # 1 minute
REPORT_INTERVAL=300000         # 5 minutes
```

4. Start Redis (using Docker):
```bash
docker run --name monitor-redis -p 6379:6379 -d redis
```

## Usage

### Starting the Server

```bash
# Development mode
npm run dev:server

# Production mode
npm run start:server
```

### Starting the Client

```bash
# Development mode
npm run dev:client

# Production mode
npm run start:client
```

### Client Configuration

Create a `.env.client` file:
```bash
CLIENT_ID=unique_client_name
PROJECT_NAME=Your Project
LOCATION=Server Location
OWNER=Team Name
SERVER_URL=http://localhost:3000
```

## API Endpoints

### Check System Status
```bash
GET /health
```

### Send Custom Alert
```bash
POST /api/alerts
Content-Type: application/json

{
  "type": "CUSTOM_ALERT",
  "message": "Alert message",
  "severity": "info",
  "metadata": {
    "projectName": "Project Name",
    "location": "Location",
    "component": "Component Name"
  }
}
```

### Update Connection Status
```bash
POST /api/status
Content-Type: application/json

{
  "clientId": "client-id",
  "status": "online",
  "metadata": {
    "projectName": "Project Name",
    "location": "Location"
  }
}
```

## Telegram Integration

1. Create a new bot with [@BotFather](https://t.me/botfather)
2. Get the bot token
3. Start a chat with your bot
4. Get your chat ID:
   ```bash
   curl https://api.telegram.org/bot<YourBOTToken>/getUpdates
   ```
5. Add the token and chat ID to your .env file

## Alert Types

- Connection Status
  - Client Connected/Disconnected
  - Connection Lost
- System Health
  - High CPU Usage (>80%)
  - High Memory Usage (>90%)
  - Regular Health Reports
- Custom Alerts
  - User-defined alerts with custom metadata

## Docker Support

Build and run using Docker:

```bash
# Build image
docker build -t connection-monitor .

# Run server
docker-compose up
```

## Development

Building the project:
```bash
# Build TypeScript files
npm run build

# Watch mode
npm run watch
```