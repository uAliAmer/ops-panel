# Build the panel and serve it as static files.
#
# Two build args, both optional:
#   BASE_PATH  path the app is mounted at (default /admin; empty for the root)
#   VITE_DEMO  1 to bake in the fixture backend, for a demo deploy
#
#   docker build -t ops-panel .
#   docker build -t ops-panel-demo --build-arg BASE_PATH= --build-arg VITE_DEMO=1 .
#   docker run -p 8080:80 ops-panel

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

ARG BASE_PATH=/admin
ARG VITE_DEMO=0
ARG VITE_PUBLIC_ORDER_ORIGIN
ARG VITE_OPS_APP_BASE
ARG VITE_PORTAL_URL
ARG VITE_IMAGE_CDN
ENV BASE_PATH=$BASE_PATH VITE_DEMO=$VITE_DEMO \
    VITE_PUBLIC_ORDER_ORIGIN=$VITE_PUBLIC_ORDER_ORIGIN \
    VITE_OPS_APP_BASE=$VITE_OPS_APP_BASE \
    VITE_PORTAL_URL=$VITE_PORTAL_URL \
    VITE_IMAGE_CDN=$VITE_IMAGE_CDN
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
