FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/servers/m365 ./dist/servers/m365
EXPOSE 8080
CMD ["node", "dist/servers/m365/http.js"]
