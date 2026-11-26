#!/usr/bin/env bash
# Installs the nginx settings kept in deploy/nginx/ into nginx's conf.d and
# reloads nginx, so a fix to them ships like code: the production deploy runs
# this after every merge.
#
# If nginx rejects the result, conf.d is put back exactly as it was. A file
# that fails nginx's test must never stay behind: it would stop nginx at its
# next restart and take the site down.
#
# Usage: apply-nginx.sh [conf.d directory, default /etc/nginx/conf.d]
set -euo pipefail

SRC="$(dirname "$0")/../../deploy/nginx"
DEST="${1:-/etc/nginx/conf.d}"

ls "$SRC"/*.conf >/dev/null 2>&1 || exit 0
if [ ! -d "$DEST" ] || ! sudo -n true 2>/dev/null; then
  echo "::warning::No $DEST or no passwordless sudo: the settings in deploy/nginx/ were not installed."
  exit 0
fi

BACKUP="$(mktemp -d)"
trap 'sudo -n rm -rf "$BACKUP"' EXIT
sudo -n cp -a "$DEST/." "$BACKUP/"
sudo -n cp "$SRC"/*.conf "$DEST/"

if sudo -n nginx -t; then
  sudo -n systemctl reload nginx
  echo "nginx settings installed: $(cd "$SRC" && echo *.conf)"
else
  for f in "$SRC"/*.conf; do sudo -n rm -f "$DEST/$(basename "$f")"; done
  sudo -n cp -a "$BACKUP/." "$DEST/"
  echo "::error::nginx rejected the files in deploy/nginx/, so conf.d was put back as it was."
  exit 1
fi
