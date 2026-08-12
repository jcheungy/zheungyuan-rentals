FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    fonts-liberation \
    git \
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

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Both upstream fixes below were authored against this exact whatsapp-web.js
# base commit (version 1.34.7, but newer than the published npm tag).
ARG WWEBJS_BASE=942d236a11ad68807308b058303ba5256915979c

RUN git clone https://github.com/wwebjs/whatsapp-web.js.git /tmp/wwebjs \
 && cd /tmp/wwebjs \
 && git checkout "$WWEBJS_BASE" \
 && patch --batch --forward -p1 < /app/patches/wwebjs-pr-201850.patch \
 && patch --batch --forward -p1 < /app/patches/wwebjs-pr-201853.patch \
 && rm -rf /app/node_modules/whatsapp-web.js \
 && cp -a /tmp/wwebjs /app/node_modules/whatsapp-web.js \
 && rm -rf /tmp/wwebjs

# Refuse to deploy if either upstream fix is absent.
RUN grep -q "window.WWebJS.getMsgKeyId" /app/node_modules/whatsapp-web.js/src/util/Injected/Utils.js \
 && grep -q "skip chats that fail serialization" /app/node_modules/whatsapp-web.js/src/util/Injected/Utils.js \
 && grep -q "EMIT_BY_SCREEN" /app/node_modules/whatsapp-web.js/src/Client.js \
 && grep -q "WAWebStreamModel" /app/node_modules/whatsapp-web.js/src/Client.js

ENV WWEBJS_BASE=942d236a11ad68807308b058303ba5256915979c
ENV WWEBJS_PATCHES=PR201850+PR201853

CMD ["node","server.js"]
