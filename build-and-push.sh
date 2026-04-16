#!/bin/bash

# NCE Flow Docker 镜像构建和推送脚本
# 与 GitHub Actions 保持一致：使用 Buildx 构建 amd64/arm64 并直接推送。
# 运行前请先执行 docker login，脚本会优先使用当前已登录的 Docker Hub 账号。
# 使用方法: ./build-and-push.sh <version>
# 例如: ./build-and-push.sh 1.6.0

set -euo pipefail

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

usage() {
    echo -e "${RED}错误: 请提供版本号${NC}"
    echo "使用方法: $0 <version>"
    echo "例如: $0 1.6.0"
}

require_command() {
    local cmd=$1
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo -e "${RED}错误: 未找到命令 '$cmd'${NC}"
        exit 1
    fi
}

get_logged_in_username() {
    docker info 2>/dev/null | sed -n 's/^ Username: //p' | head -n1
}

if [ $# -lt 1 ] || [ -z "${1:-}" ]; then
    usage
    exit 1
fi

VERSION=$1
IMAGE_NAME=${IMAGE_NAME:-nce-flow}
PLATFORMS=${PLATFORMS:-linux/amd64,linux/arm64}
BUILDER_NAME=${BUILDER_NAME:-nce-flow-multiarch}

require_command docker

if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}错误: Docker daemon 不可用，请先启动 Docker。${NC}"
    exit 1
fi

if ! docker buildx version >/dev/null 2>&1; then
    echo -e "${RED}错误: 当前 Docker 未启用 buildx，请先安装或启用 Docker Buildx。${NC}"
    exit 1
fi

echo -e "${GREEN}开始构建并推送 NCE Flow Docker 镜像...${NC}"
echo "版本: ${VERSION}"
echo "平台: ${PLATFORMS}"
echo ""

echo -e "${YELLOW}检查 Docker Hub 登录状态...${NC}"
if ! docker info 2>/dev/null | grep -q "Username:"; then
    echo -e "${YELLOW}未检测到 Docker Hub 登录状态，执行 docker login...${NC}"
    docker login
fi

DOCKER_USERNAME=${DOCKER_USERNAME:-$(get_logged_in_username)}
if [ -z "${DOCKER_USERNAME}" ]; then
    echo -e "${RED}错误: 无法识别当前 Docker Hub 用户名。${NC}"
    echo "请先执行 docker login，或显式设置环境变量 DOCKER_USERNAME。"
    exit 1
fi

FULL_IMAGE_NAME="${DOCKER_USERNAME}/${IMAGE_NAME}"

echo "镜像名称: ${FULL_IMAGE_NAME}"

echo -e "${YELLOW}准备 buildx builder...${NC}"
if ! docker buildx inspect "${BUILDER_NAME}" >/dev/null 2>&1; then
    docker buildx create --name "${BUILDER_NAME}" --use
else
    docker buildx use "${BUILDER_NAME}"
fi
docker buildx inspect --bootstrap >/dev/null

echo -e "${GREEN}步骤 1/1: Buildx 多架构构建并推送...${NC}"
docker buildx build \
    --platform "${PLATFORMS}" \
    --tag "${FULL_IMAGE_NAME}:${VERSION}" \
    --tag "${FULL_IMAGE_NAME}:latest" \
    --push \
    .

echo ""
echo -e "${GREEN}✓ 镜像发布成功！${NC}"
echo ""
echo "用户现在可以使用以下命令运行:"
echo -e "${YELLOW}docker run -d -p 8080:80 ${FULL_IMAGE_NAME}:${VERSION}${NC}"
echo "或"
echo -e "${YELLOW}docker run -d -p 8080:80 ${FULL_IMAGE_NAME}:latest${NC}"
echo ""
echo "Docker Hub 链接: https://hub.docker.com/r/${FULL_IMAGE_NAME}"
