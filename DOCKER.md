# Docker 部署指南

本文档介绍如何使用 Docker 部署 EchoFlow 应用。

## 前置要求

- Docker (版本 20.10 或更高)

## 快速开始（推荐）

### 使用 Docker Hub 镜像

这是最简单的方式，只需一条命令：

```bash
docker run -d \
  --name echo-flow \
  -p 8080:80 \
  --restart unless-stopped \
  luzhenhua/echo-flow:latest
```

然后访问 `http://localhost:8080` 即可使用。

**自定义端口示例：**
```bash
# 使用 3000 端口
docker run -d --name echo-flow -p 3000:80 --restart unless-stopped luzhenhua/echo-flow:latest
```

**指定版本：**
```bash
docker run -d --name echo-flow -p 8080:80 --restart unless-stopped luzhenhua/echo-flow:latest
```

## 其他部署方式

### 方法二：使用 Docker Compose

需要额外配置时可以使用 Docker Compose。

1. 克隆项目到本地：
```bash
git clone https://github.com/luzhenhua/echo-flow.git
cd echo-flow
```

2. 启动服务：
```bash
docker-compose up -d
```

3. 访问应用：
打开浏览器访问 `http://localhost:8080`

4. 停止服务：
```bash
docker-compose down
```

### 方法二：使用 Docker 命令从源码构建

适用于需要自定义构建的场景。

1. 构建镜像：
```bash
docker build -t echo-flow:latest .
```

2. 运行容器：
```bash
docker run -d \
  --name echo-flow \
  -p 8080:80 \
  --restart unless-stopped \
  echo-flow:latest
```

3. 访问应用：
打开浏览器访问 `http://localhost:8080`

4. 停止容器：
```bash
docker stop echo-flow
docker rm echo-flow
```

## 配置说明

### 端口配置

默认端口映射为 `8080:80`，如需修改外部端口，可以编辑 `docker-compose.yml`：

```yaml
ports:
  - "你的端口:80"  # 例如 "3000:80"
```

### 数据持久化

应用本身不含任何课程内容，音频与字幕由用户在浏览器内导入并保存在本机 IndexedDB，服务端无需为课程内容挂载卷。

### 用户数据持久化与多设备同步（可选）

学习进度、收藏与设置默认存于浏览器本地。挂载数据卷后，这些数据会自动持久化到服务器磁盘，并在多设备间同步：

```yaml
volumes:
  - ./data:/app/data
```

- 同步全自动、无感：收藏 / 进度 / 设置的任何变化会自动上传；其他设备打开时自动拉取最新数据。
- 清除浏览器缓存不再丢失数据。
- **可选访问令牌**：若实例对公网开放，建议设置令牌，避免数据被任意读写：

```yaml
environment:
  - NCE_DATA_TOKEN=你的令牌
```

  设置后，应用会在首次同步时提示输入同一令牌。

- 不挂载该卷时，应用行为与纯静态站点完全一致（仅用浏览器本地存储）。
- 注意：挂载的宿主目录需对容器可写（如遇权限问题可执行 `chmod 777 ./data`）。

## 高级用法

### 查看容器日志

```bash
docker-compose logs -f
```

或

```bash
docker logs -f echo-flow
```

### 重启容器

```bash
docker-compose restart
```

### 更新应用

1. 拉取最新代码：
```bash
git pull
```

2. 重新构建并启动：
```bash
docker-compose up -d --build
```

### 健康检查

容器配置了健康检查，会定期检测服务是否正常运行。查看健康状态：

```bash
docker ps
```

在 STATUS 列会显示健康状态。

## 生产环境部署建议

### 1. 使用反向代理

推荐在生产环境使用 Nginx 或 Traefik 作为反向代理，配置 HTTPS：

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 2. 资源限制

在生产环境中限制容器资源使用，编辑 `docker-compose.yml`：

```yaml
services:
  echo-flow:
    # ... 其他配置
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 256M
```

### 3. 日志管理

配置日志驱动和日志轮转：

```yaml
services:
  echo-flow:
    # ... 其他配置
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

## 故障排查

### 容器无法启动

1. 检查端口是否被占用：
```bash
lsof -i :8080
```

2. 查看容器日志：
```bash
docker-compose logs
```

### 无法访问应用

1. 确认容器正在运行：
```bash
docker ps
```

2. 检查防火墙设置：
```bash
# 允许 8080 端口
sudo ufw allow 8080
```

### 性能问题

1. 检查容器资源使用情况：
```bash
docker stats echo-flow
```

2. 如果内存或 CPU 使用过高，考虑增加资源限制

## 卸载

完全移除应用和相关数据：

```bash
# 停止并删除容器
docker-compose down

# 删除镜像
docker rmi echo-flow:latest

# 删除网络（如果不再使用）
docker network rm echo-network
```

## 技术栈

- **基础镜像**: openresty/openresty:alpine
- **Web 服务器**: OpenResty (Nginx + Lua)
- **容器编排**: Docker Compose

## 支持

如有问题或建议，请在 [GitHub Issues](https://github.com/luzhenhua/echo-flow/issues) 提交。
