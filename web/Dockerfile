FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=optional

COPY tsconfig.json ./
COPY src ./src
COPY views ./views
COPY public ./public

# @simplewebauthn/browser の UMD バンドルを公開ディレクトリへ取り込む（CDN不使用・CSP self準拠）
RUN mkdir -p public/vendor && \
    cp node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js \
       public/vendor/simplewebauthn-browser.umd.min.js

# 永続データ(/data)を node 所有に（名前付きvolumeが所有権を継承する）
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

USER node
ENV NODE_ENV=production
CMD ["npm", "start"]
