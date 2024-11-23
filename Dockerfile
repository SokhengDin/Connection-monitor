FROM node:20-slim

WORKDIR /usr/src/app


COPY package*.json ./

RUN npm ci --only=production && \
    npm uninstall electron && \
    npm cache clean --force

COPY . .

RUN npm run build:client

ENV NODE_ENV=production
ENV HEADLESS=true


RUN useradd -r -u 1001 -g root nonroot && \
    chown -R nonroot:root /usr/src/app
USER nonroot

CMD ["node", "./dist/client/main/main.js"]