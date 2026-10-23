# The Slack bot. Any host that runs a container works (Fly.io, Render, Railway, Cloud Run with min instances 1).
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY config ./config
COPY src ./src
ENV NODE_ENV=production
CMD ["node", "src/bot/app.js"]
