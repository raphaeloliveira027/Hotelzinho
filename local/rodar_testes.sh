#!/usr/bin/env bash
# Recria o banco local e roda os testes. Resultado salvo em docs/resultado_testes_banco.txt
set -euo pipefail
cd "$(dirname "$0")/.."
export PGHOST="${PGHOST:-/tmp}" PGUSER="${PGUSER:-postgres}"
bash local/montar_banco.sh >/dev/null
mkdir -p docs
{ echo "Executado em: $(date '+%d/%m/%Y %H:%M')"; psql -q -d hotelzinho -f supabase/tests/testes_banco.sql 2>&1 | sed -n '/RESULTADO DOS TESTES/,$p'; } | tee docs/resultado_testes_banco.txt
