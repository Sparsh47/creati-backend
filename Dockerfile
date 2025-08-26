FROM node:20 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run prisma:generate

RUN npm run build


FROM node:20-slim AS runner

WORKDIR /app

COPY --from=builder /app/package*.json ./
RUN npm install --omit=dev --ignore-scripts --prefer-offline

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 8000

CMD ["node", "dist/index.js"]
