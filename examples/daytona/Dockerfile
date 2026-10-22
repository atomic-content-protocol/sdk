# Container image for the ACP Daytona benchmark.
# Build-time network installs the CLI. At runtime the agent reads the local
# vault through `acp serve` and does not contact a hosted ACP service.
# Daytona container snapshots can be created from this file via
# Image.fromDockerfile. Linux VM snapshots cannot; see src/image.ts.
FROM node:22-bookworm-slim

WORKDIR /opt/acp

RUN npm install --omit=dev @atomic-content-protocol/cli@0.3.2 \
  && npm cache clean --force

ENV PATH="/opt/acp/node_modules/.bin:${PATH}"

COPY policy.json /opt/acp/policy.json
COPY sandbox/agent.mjs /opt/acp/agent.mjs
COPY corpus/questions.json /opt/acp/questions.json
COPY corpus/manifest.json /opt/acp/manifest.json
COPY corpus/pages /opt/acp/pages
COPY corpus/vault /opt/acp/vault

CMD ["node", "/opt/acp/agent.mjs"]
