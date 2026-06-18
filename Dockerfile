FROM node:20-slim

WORKDIR /app

# Install deps first for better layer caching.
COPY package*.json ./
RUN npm ci

# Copy the rest and build the UV client bundle into public/.
COPY . .
RUN npm run build:uv

ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080

# wisp needs persistent WebSocket connections — run as a long-lived process.
CMD ["node", "server/index.js"]
