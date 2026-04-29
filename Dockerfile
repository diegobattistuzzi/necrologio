ARG BUILD_FROM
FROM $BUILD_FROM

RUN apk add --no-cache nodejs npm

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY run.sh ./

RUN chmod a+x /app/run.sh

CMD ["/app/run.sh"]
