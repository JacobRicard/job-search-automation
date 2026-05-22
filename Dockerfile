FROM node:20-slim

# Build tools needed to compile better-sqlite3 native module; pip3 for pydantic contract validation
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY requirements.txt ./
RUN pip3 install --break-system-packages -r requirements.txt

COPY . .

EXPOSE 3131

CMD ["node", "dashboard.js"]
