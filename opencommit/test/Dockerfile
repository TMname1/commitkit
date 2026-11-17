FROM ubuntu:latest

RUN apt-get update && apt-get install -y curl git

# Install Node.js v20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
RUN apt-get install -y nodejs

# Setup git
RUN git config --global user.email "test@example.com"
RUN git config --global user.name "Test User"

# Build context is the repository root: docker build -f opencommit/test/Dockerfile .
WORKDIR /app
COPY package.json package-lock.json /app/

RUN npm ci
COPY . /app
RUN npm run build
