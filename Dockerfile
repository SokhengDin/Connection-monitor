FROM node:18-slim

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN npm run build:client

ENV NODE_ENV=production

CMD ["npm", "run", "start:client"]