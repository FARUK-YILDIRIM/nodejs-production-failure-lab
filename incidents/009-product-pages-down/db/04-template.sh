#!/bin/sh
# Keep a pristine copy of the seeded database, so the lab can reset the data in
# seconds (`./lab reset`, and before measuring the original code's baseline).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -c "CREATE DATABASE shop_pristine TEMPLATE $POSTGRES_DB"
