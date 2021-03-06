FROM node:10.15-alpine

WORKDIR /app

COPY package.json .
COPY yarn.lock .
RUN yarn

COPY search.js .


CMD ["node", "search.js"]
