FROM node:10.15.1-stretch

USER node
WORKDIR /home/node/app

CMD node src/index.js
