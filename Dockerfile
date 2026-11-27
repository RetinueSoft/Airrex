# AirRex image: builds the web app, then runs the Node server (API + static files) on port 8080.
# Web-app settings (VITE_*) are fixed at build time; pass them as build args if they differ from the defaults.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_AGENT_PLAN_PRICE
ARG VITE_AGENT_TRIAL_DAYS
ARG VITE_SUPPORT_WHATSAPP
ARG VITE_SUPPORT_EMAIL
ARG VITE_MAX_QUOTES_PER_AGENT
# Live site address, added to the AirRex Helper extension download (/airrex-helper.zip).
ARG AIRREX_SITE_URL
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY shared ./shared
RUN mkdir -p .cache && chown node:node .cache
USER node
EXPOSE 8080
CMD ["node", "server/index.ts"]
