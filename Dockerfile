FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY backend ./backend
COPY public ./public
EXPOSE 3000
CMD ["node", "backend/api.js"]
