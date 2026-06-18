FROM node:20-slim
# Puppeteer dependencies for WhatsApp Web
RUN apt-get update && apt-get install -y \
    chromium fonts-noto-color-emoji libatk-bridge2.0-0 \
    libcups2 libxkbcommon0 libxrandr2 libgbm1 libasound2 \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["node", "src/index.js"]
