# Optional sandbox template for Agent mode: adds Playwright + Chromium so browser_open
# returns rendered text and screenshots. The app works on the default template without it.
FROM e2bdev/base:latest

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip nodejs npm git curl jq \
  && rm -rf /var/lib/apt/lists/*

# Browsers in a shared path so the sandbox user (not root) can launch them.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN (pip install --no-cache-dir playwright requests beautifulsoup4 \
  || pip install --no-cache-dir --break-system-packages playwright requests beautifulsoup4) \
  && python3 -m playwright install --with-deps chromium \
  && chmod -R a+rx /ms-playwright
