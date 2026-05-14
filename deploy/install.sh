#!/usr/bin/env bash
#
# VPS install script for the Email Finder API.
# Tested on Ubuntu 22.04 / 24.04 and Debian 12.
#
# Usage (as root, or with sudo):
#   bash deploy/install.sh
#
# After install, edit /opt/email-finder/.env (set API_KEY, SENDER_EMAIL, HELO_HOSTNAME)
# then run:
#   sudo systemctl restart email-finder

set -euo pipefail

APP_DIR=/opt/email-finder
APP_USER=emailfinder
APP_GROUP=emailfinder
PYTHON=${PYTHON:-python3}

if [[ "${EUID}" -ne 0 ]]; then
    echo "Run with sudo." >&2
    exit 1
fi

echo ">> Installing system dependencies..."
apt-get update
apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip nginx ca-certificates curl

echo ">> Creating service user..."
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
    useradd --system --create-home --shell /usr/sbin/nologin "${APP_USER}"
fi

echo ">> Syncing app to ${APP_DIR}..."
mkdir -p "${APP_DIR}"
# Copy from current directory (where this script lives) to APP_DIR
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rsync -a --delete \
    --exclude='.git' --exclude='venv' --exclude='data' --exclude='.env' \
    "${SCRIPT_DIR}/" "${APP_DIR}/"
mkdir -p "${APP_DIR}/data"
chown -R "${APP_USER}:${APP_GROUP}" "${APP_DIR}"

echo ">> Setting up Python virtualenv..."
sudo -u "${APP_USER}" "${PYTHON}" -m venv "${APP_DIR}/venv"
sudo -u "${APP_USER}" "${APP_DIR}/venv/bin/pip" install --upgrade pip
sudo -u "${APP_USER}" "${APP_DIR}/venv/bin/pip" install -r "${APP_DIR}/requirements.txt"

echo ">> Configuring environment file..."
if [[ ! -f "${APP_DIR}/.env" ]]; then
    cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
    # Generate a random API key
    KEY=$(openssl rand -hex 32)
    sed -i "s|change-me-to-a-long-random-string|${KEY}|" "${APP_DIR}/.env"
    chown "${APP_USER}:${APP_GROUP}" "${APP_DIR}/.env"
    chmod 600 "${APP_DIR}/.env"
    echo "   Generated API key: ${KEY}"
    echo "   Saved to ${APP_DIR}/.env"
else
    echo "   ${APP_DIR}/.env already exists; leaving it alone."
fi

echo ">> Installing systemd service..."
cp "${APP_DIR}/deploy/systemd/email-finder.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable email-finder
systemctl restart email-finder

echo ">> Installing nginx site (you must still edit server_name and add TLS)..."
cp "${APP_DIR}/deploy/nginx/email-finder.conf" /etc/nginx/sites-available/email-finder
if [[ ! -L /etc/nginx/sites-enabled/email-finder ]]; then
    ln -s /etc/nginx/sites-available/email-finder /etc/nginx/sites-enabled/email-finder
fi
nginx -t && systemctl reload nginx

echo ""
echo "=========================================="
echo "Done. Next steps:"
echo "  1. Edit /etc/nginx/sites-available/email-finder and replace the"
echo "     server_name with your real subdomain. Then: sudo systemctl reload nginx"
echo "  2. Run certbot for HTTPS: sudo certbot --nginx -d <your-subdomain>"
echo "  3. Edit /opt/email-finder/.env, set SENDER_EMAIL and HELO_HOSTNAME to"
echo "     real values on a domain you own, then: sudo systemctl restart email-finder"
echo "  4. Smoke test:"
echo "       curl -s http://127.0.0.1:8000/health"
echo "=========================================="
