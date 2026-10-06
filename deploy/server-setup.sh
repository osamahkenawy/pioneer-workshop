#!/bin/bash
# ============================================================
# One-time server setup for car-workshop staging
# Run as: bash server-setup.sh
# ============================================================
set -e

echo "=== [1/6] System update ==="
sudo apt-get update -y && sudo apt-get upgrade -y

echo "=== [2/6] Install Node.js 20 ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "=== [3/6] Install PM2, Git, Nginx ==="
sudo npm install -g pm2
sudo apt-get install -y git nginx

echo "=== [4/6] Create app directories ==="
sudo mkdir -p /var/www/car-workshop/frontend
sudo mkdir -p /var/www/car-workshop/backend
sudo chown -R $USER:$USER /var/www/car-workshop

echo "=== [5/6] Copy Nginx config ==="
sudo cp /tmp/car-workshop-nginx.conf /etc/nginx/sites-available/car-workshop
sudo ln -sf /etc/nginx/sites-available/car-workshop /etc/nginx/sites-enabled/car-workshop
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "=== [6/6] Enable PM2 on boot ==="
pm2 startup systemd -u $USER --hp $HOME | tail -1 | sudo bash -

echo ""
echo "✅ Server setup complete!"
echo "   Node: $(node -v)"
echo "   NPM:  $(npm -v)"
echo "   PM2:  $(pm2 -v)"
