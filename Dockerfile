FROM node:16 as base
WORKDIR /usr/src/outage-bot
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "index.js"]