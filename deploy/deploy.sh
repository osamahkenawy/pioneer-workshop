#!/bin/bash
# ============================================================
# Deploy car-workshop frontend + backend to staging
# Run as: bash deploy.sh
# ============================================================
set -e

BACKEND_DIR="/var/www/car-workshop/backend"
FRONTEND_DIR="/var/www/car-workshop/frontend"
BACKEND_REPO="https://github.com/osamahkenawy/car-workshop-backend.git"
FRONTEND_REPO="https://github.com/osamahkenawy/car-workshop-frontend.git"

echo ""
echo "=========================================="
echo "  Car Workshop - Staging Deploy"
echo "=========================================="

# ---- BACKEND ----
echo ""
echo "--- [1/4] Deploy Backend ---"
if [ -d "$BACKEND_DIR/.git" ]; then
  echo "  Pulling latest backend..."
  cd "$BACKEND_DIR"
  git fetch origin
  git reset --hard origin/main
else
  echo "  Cloning backend..."
  git clone "$BACKEND_REPO" "$BACKEND_DIR"
  cd "$BACKEND_DIR"
fi

echo "  Installing backend dependencies..."
npm install --omit=dev

echo "  Copying staging .env..."
cp /tmp/backend.env "$BACKEND_DIR/.env"

echo "  Running DB migrations..."
# Import schema if tables don't exist
mysql -u root -p"${DB_PASS:?Set DB_PASS to the MySQL root password}" car_workshop < "$BACKEND_DIR/src/migrations/car_workshop.sql" 2>/dev/null || true
mysql -u root -p"${DB_PASS:?Set DB_PASS to the MySQL root password}" car_workshop < "$BACKEND_DIR/src/migrations/post/00_schema_patches.sql" 2>/dev/null || true
mysql -u root -p"${DB_PASS:?Set DB_PASS to the MySQL root password}" car_workshop < "$BACKEND_DIR/src/migrations/post/01_seed_countries.sql" 2>/dev/null || true

echo "  (Re)starting backend with PM2..."
pm2 delete car-workshop-backend 2>/dev/null || true
pm2 start "$BACKEND_DIR/src/server.js" \
  --name car-workshop-backend \
  --node-args="--experimental-vm-modules" \
  --env production \
  --max-memory-restart 512M
pm2 save

# ---- FRONTEND ----
echo ""
echo "--- [2/4] Deploy Frontend ---"
FRONTEND_BUILD_TMP="/tmp/car-workshop-frontend-build"
if [ -d "$FRONTEND_BUILD_TMP/.git" ]; then
  echo "  Pulling latest frontend..."
  cd "$FRONTEND_BUILD_TMP"
  git fetch origin
  git reset --hard origin/main
else
  echo "  Cloning frontend..."
  rm -rf "$FRONTEND_BUILD_TMP"
  git clone "$FRONTEND_REPO" "$FRONTEND_BUILD_TMP"
  cd "$FRONTEND_BUILD_TMP"
fi

echo "  Installing frontend dependencies..."
npm install

echo "  Building frontend..."
npm run build

echo "  Copying build to web root..."
sudo rm -rf "$FRONTEND_DIR"/*
sudo cp -r "$FRONTEND_BUILD_TMP/dist/." "$FRONTEND_DIR/"

# ---- NGINX ----
echo ""
echo "--- [3/4] Reload Nginx ---"
sudo nginx -t && sudo systemctl reload nginx

# ---- STATUS ----
echo ""
echo "--- [4/4] Status ---"
pm2 status
echo ""
echo "✅ Deployment complete!"
echo "   Frontend: http://workshop.pioneeruae.com"
echo "   Backend:  http://workshop.pioneeruae.com/api"
