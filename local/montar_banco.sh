#!/usr/bin/env bash
# Recria do zero o banco local "hotelzinho" com estrutura, regras e dados fictícios.
# Uso: bash local/montar_banco.sh   (variáveis PGHOST/PGUSER/PGPORT opcionais)
set -euo pipefail
cd "$(dirname "$0")/.."
export PGHOST="${PGHOST:-/tmp}" PGUSER="${PGUSER:-postgres}"
DB=hotelzinho
PSQL="psql -v ON_ERROR_STOP=1 -q -d $DB"

dropdb --if-exists --force "$DB"
createdb "$DB"
$PSQL -f local/00_simula_supabase.sql
for f in supabase/migrations/*.sql; do echo "-> $f"; $PSQL -f "$f"; done
$PSQL -f local/01_usuarios_ficticios.sql
$PSQL -f supabase/seed.sql
echo "Banco '$DB' pronto."
