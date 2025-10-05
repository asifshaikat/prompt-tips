#!/usr/bin/env bash
set -euo pipefail
apt-get update
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow "Nginx Full"
ufw limit 22/tcp
ufw --force enable
ufw status verbose
