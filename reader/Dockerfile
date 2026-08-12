FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    patch \
    xdg-utils \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# whatsapp-web.js 1.34.7 is the latest published release as of Aug 2026,
# but WhatsApp Web 2.3000.104xxx introduced an upstream getChats() "r: r"
# regression. Apply the exact upstream PR #201850 patch while it remains
# unmerged/unreleased.
RUN node -e "const v=require('./node_modules/whatsapp-web.js/package.json').version; if(v!=='1.34.7'){console.error('Unexpected whatsapp-web.js version:',v); process.exit(1)}"
RUN patch --batch --forward -p1 -d node_modules/whatsapp-web.js < patches/wwebjs-pr-201850.patch

# Fail the image build rather than deploy an unpatched reader.
RUN grep -q "window.WWebJS.getMsgKeyId" node_modules/whatsapp-web.js/src/util/Injected/Utils.js \
 && grep -q "skip chats that fail serialization" node_modules/whatsapp-web.js/src/util/Injected/Utils.js

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV WWEBJS_PATCH=PR201850-5b6bb00

CMD ["node","server.js"]
