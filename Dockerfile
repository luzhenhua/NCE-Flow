# EchoFlow Docker Image
# 基于 OpenResty（Nginx + Lua）：静态服务照旧，并额外提供可选的 /api/userData 数据持久化接口
FROM openresty/openresty:alpine

# 设置维护者信息和标签
LABEL maintainer="luzhenhua <luzhenhuadev@qq.com>"
LABEL description="EchoFlow - 点读跟读练习工具（自备资源）"
LABEL org.opencontainers.image.source="https://github.com/luzhenhua/NCE-Flow"
LABEL org.opencontainers.image.description="点读跟读练习工具：导入你的 mp3+lrc，点句即读、连续播放"
LABEL org.opencontainers.image.licenses="MIT"

# 复制自定义 Nginx 配置与 Lua 处理器
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY lua /etc/nginx/lua

# 复制所有项目文件到静态文件目录（nginx.conf 中 root 显式指向此处）
COPY assets /usr/share/nginx/html/assets
COPY static /usr/share/nginx/html/static
COPY images /usr/share/nginx/html/images
COPY icons /usr/share/nginx/html/icons
COPY *.html /usr/share/nginx/html/
COPY manifest.json sw.js /usr/share/nginx/html/
COPY robots.txt sitemap.xml /usr/share/nginx/html/
COPY favicon.ico /usr/share/nginx/html/

# 设置权限、创建数据目录，并向主配置注入 env 指令
# （Nginx 默认清除环境变量，必须声明 env 后 Lua 的 os.getenv 才能读到 NCE_DATA_TOKEN）
RUN chmod -R 755 /usr/share/nginx/html \
 && mkdir -p /app/data && chmod 777 /app/data \
 && sed -i '1i env NCE_DATA_TOKEN;' /usr/local/openresty/nginx/conf/nginx.conf

# 数据卷：挂载后用户数据持久化到宿主机
VOLUME ["/app/data"]

# 暴露 80 端口
EXPOSE 80

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

# 启动 OpenResty
# 启动时（挂载已生效）确保数据目录可写：worker 多以 nobody 运行，而挂载点权限来自宿主目录
CMD ["sh", "-c", "chmod 777 /app/data 2>/dev/null || true; exec openresty -g 'daemon off;'"]
