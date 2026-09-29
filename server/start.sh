#!/bin/bash
# 解析サーバーを起動する（初回は必要なものを入れる）
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "初回セットアップ中…"
  PY=$(command -v python3.13 || command -v python3.12 || command -v python3.11 || echo python3)
  "$PY" -m venv .venv && .venv/bin/pip install -q -r requirements.txt || exit 1
fi
command -v ffmpeg >/dev/null || [ -x /opt/homebrew/bin/ffmpeg ] || { echo "ffmpeg が必要です: brew install ffmpeg"; exit 1; }
[ -f .env ] || { cp .env.example .env; echo "server/.env を作りました。ANTHROPIC_API_KEY を入れてから再度起動してください"; }
echo "http://localhost:8000 を開いてください"
exec .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
