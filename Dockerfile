FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    DATA_DIR=/var/data \
    CREWAI_PYTHON=/opt/crew-env/bin/python

WORKDIR /opt/render/project/src

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/crew-env

COPY requirements-crewai.txt ./
RUN /opt/crew-env/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/crew-env/bin/pip install --no-cache-dir -r requirements-crewai.txt

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

EXPOSE 10000
CMD ["npm", "start"]
