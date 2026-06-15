#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_CMD=()
if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo "错误：未找到 docker compose，请先安装 Docker。" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "错误：无法连接 Docker 守护进程，请确认 Docker 已启动且当前用户有权限。" >&2
  exit 1
fi

if [[ -d .git ]] && command -v git >/dev/null 2>&1; then
  echo "==> 拉取最新代码..."
  git pull --ff-only origin main || git pull --ff-only || true
fi

if [[ ! -f .env.docker ]]; then
  echo "==> 创建 .env.docker（来自 .env.docker.example）"
  cp .env.docker.example .env.docker
fi

echo "==> 构建并启动容器..."
"${COMPOSE_CMD[@]}" --env-file .env.docker up -d --build --remove-orphans

echo
HOST_PORT="$(grep -E '^HOST_PORT=' .env.docker | tail -n1 | cut -d= -f2- | tr -d '\r' || true)"
HOST_PORT="${HOST_PORT:-3080}"
echo "部署完成。"
echo "  本地访问: http://127.0.0.1:${HOST_PORT}"
echo "  外网访问: http://<服务器IP>:${HOST_PORT}"
echo
"${COMPOSE_CMD[@]}" ps
