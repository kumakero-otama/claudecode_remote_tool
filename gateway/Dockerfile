FROM node:20-alpine

WORKDIR /app

# 依存だけ先に入れてレイヤキャッシュを効かせる
COPY package.json ./
RUN npm install --omit=optional

COPY tsconfig.json ./
COPY src ./src

# 非rootで実行
USER node

ENV NODE_ENV=production
CMD ["npm", "start"]
