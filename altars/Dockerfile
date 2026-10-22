FROM node:24.22.1-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./

USER node
EXPOSE 8080
CMD ["node", "server.js"]
