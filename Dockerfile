FROM node:12

ENV TINI_VERSION v0.18.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
RUN chmod +x /tini
ENTRYPOINT ["/tini", "--"]

RUN mkdir -p /server/node_modules && chown -R node:node /server
WORKDIR /server

COPY package*.json ./

USER node

RUN npm i --only=prod

COPY --chown=node:node src/ ./src
# COPY --chown=node:node static/ ./static/
COPY --chown=node:node storage/ ./storage/

CMD ["node", "src/index"]