FROM node:18-alpine AS build
WORKDIR /app
COPY . .
RUN yarn install
RUN yarn build

FROM nginx:1.24-alpine
COPY --from=build /app/dist /usr/share/nginx/html

# 复制启动脚本
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

COPY nginx.conf /etc/nginx/conf.d/default.conf.template
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
