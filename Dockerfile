FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY . .

EXPOSE 3456

CMD ["node", "server.js"]
