#!/bin/bash
# Car Workshop - Update deploy for Ubuntu staging server
# Run from: /var/www/car-workshop/backend
# Usage: bash deploy-server.sh
set -e

BACKEND_DIR="/var/www/car-workshop/backend"
FRONTEND_DIR="/var/www/car-workshop/frontend"
FRONTEND_REPO="https://github.com/osamahkenawy/car-workshop-frontend.git"
FRONTEND_TMP="/tmp/car-workshop-frontend-src"

echo "=========================================="
echo "  Car Workshop - Staging Update"
echo "  Server: \MH2ITL04"
echo "=========================================="

# -- Backend --
echo ""
echo "[1/3] Updating backend..."
cd "\"
git fetch origin && git reset --hard origin/main
npm install

echo "  Running migrations..."
mysql -u root -proot car_workshop < "\/src/migrations/car_workshop.sql"          2>/dev/null || true
mysql -u root -proot car_workshop < "\/src/migrations/post/00_schema_patches.sql" 2>/dev/null || true
mysql -u root -proot car_workshop < "\/src/migrations/post/01_seed_countries.sql"  2>/dev/null || true
mysql -u root -proot car_workshop < "\/src/migrations/post/02_sow_schema.sql"     2>/dev/null || true

echo "  Restarting backend..."
pm2 restart car-workshop-backend

# -- Frontend --
echo ""
echo "[2/3] Updating frontend..."
if [ -d "\/.git" ]; then
  cd "\"
  git fetch origin && git reset --hard origin/main
else
  rm -rf "\"
  git clone "\" "\"
  cd "\"
fi
npm install
npm run build
sudo rm -rf "\"/*
sudo cp -r "\/dist/." "\/"

# -- Done --
echo ""
echo "[3/3] Verifying..."
pm2 status
echo ""
echo "=========================================="
echo "  Done! Backend + Frontend updated."
echo "  API: http://workshop.pioneeruae.com/api"
echo "=========================================="