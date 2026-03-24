FROM node:18-alpine

# Устанавливаем инструменты для сборки bcrypt
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./

# Используем npm install вместо ci для гибкости
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
