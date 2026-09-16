#!/bin/sh
# Runs after init.sql (alphabetical order in /docker-entrypoint-initdb.d).
# Sets the password for the least-privileged application role from the
# LYRA_APP_DB_PASSWORD environment variable, so no password is baked into SQL.
set -eu

if [ -z "${LYRA_APP_DB_PASSWORD:-}" ]; then
  echo "FATAL: LYRA_APP_DB_PASSWORD is not set; cannot provision lyra_app role." >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
ALTER ROLE lyra_app WITH PASSWORD '${LYRA_APP_DB_PASSWORD}';
SQL

echo "lyra_app role password provisioned."
