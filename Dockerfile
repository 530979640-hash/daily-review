FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY . .

ENV NODE_ENV=production

EXPOSE 3456

CMD ["node", "server.js"]
