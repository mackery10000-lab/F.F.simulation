
FROM node:24-bookworm-slim

WORKDIR /app

# npm의 로컬 파일 의존성을 먼저 준비
COPY package.json package-lock.json ./
COPY vendor/three ./vendor/three

# Lockfile 기준으로 깨끗하게 설치
RUN npm ci --no-audit --no-fund

# 센싱 코드, 모션 입력, 3D 자산 복사
COPY . .

# 실제 프로젝트의 루트 빌드 실행
RUN npm test && npm run build

ENV NODE_ENV=production

# Cloudtype의 서비스 포트
EXPOSE 3000

# 비root 계정으로 실행
RUN chown -R node:node /app
USER node

# 모션 입력 API를 제공하는 Vite preview 서버
CMD ["./node_modules/.bin/vite", "preview", "--config", "app/vite.config.ts", "--host", "0.0.0.0", "--port", "3000", "--strictPort"]
