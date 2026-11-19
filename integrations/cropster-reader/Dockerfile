FROM mcr.microsoft.com/playwright:v1.64.1-noble
ENV NODE_ENV=production PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PORT=10000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=pwuser:pwuser src ./src
USER pwuser
EXPOSE 10000
CMD ["node", "src/server.mjs"]
