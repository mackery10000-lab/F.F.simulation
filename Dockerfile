
FROM node:22-bookworm-slim

WORKDIR /app

# 로컬 Three.js 패키지 의존성 포함
COPY package.json package-lock.json ./
COPY vendor/three ./vendor/three

RUN npm ci

# 프로젝트 소스 및 센싱 데이터 복사
COPY . .

# TypeScript 검사 및 Vite 빌드
RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000

USER node

CMD ["npm", "start"]
