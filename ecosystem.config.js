module.exports = {
    apps: [{
        name: 'connection-monitor',
        script: './dist/server/publisher.js',
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '1G',
        env: {
            NODE_ENV: 'production',
            PORT: 3035,
            REDIS_HOST: 'localhost',
            REDIS_PORT: 6379
        }
    }]
};