FROM nginx:1.22

RUN mkdir -p /data/nginx/cache

COPY nginx.conf /etc/nginx/nginx.conf 
COPY public/. /public/