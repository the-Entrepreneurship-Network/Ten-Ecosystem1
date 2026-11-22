# The whole portal in one image: the same steps the production deploy runs
# (npm ci, then node server.js). The React apps are already built and
# committed under public/, so there is no build step.
FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    PORT=5000 \
    JOB_CACHE_PATH=/app/.data/job-cache.json

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --omit=dev && npm cache clean --force

COPY . .

# Everything the app writes: uploads/ and .data/ (mount both as volumes), and
# the notice board, which still lives in notice.json and resets with every
# new container, as it does with every deploy today.
RUN mkdir -p uploads .data && chown node:node uploads .data notice.json
USER node

EXPOSE 5000
CMD ["node", "server.js"]
