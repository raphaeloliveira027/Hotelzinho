#!/usr/bin/env bash
# Teste de ponta a ponta das telas contra o banco local (PostgreSQL + PostgREST).
# Requer: PostgREST instalado (variável POSTGREST com o caminho do binário) e Playwright.
set -euo pipefail
cd "$(dirname "$0")/.."
RAIZ=..
POSTGREST="${POSTGREST:-postgrest}"
bash $RAIZ/local/montar_banco.sh >/dev/null
psql -h /tmp -U postgres -d hotelzinho -q -c "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'local'; END IF; END\$\$; GRANT anon, authenticated TO authenticator;"
cat > /tmp/pgrst-hotelzinho.conf <<CONF
db-uri = "postgres://authenticator:local@localhost:5432/hotelzinho"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "segredo-local-de-testes-com-mais-de-32-caracteres"
server-port = 3000
CONF
"$POSTGREST" /tmp/pgrst-hotelzinho.conf > /tmp/pgrst-hotelzinho.log 2>&1 & PID_API=$!
ANON=$(node -e "import('./e2e/jwt.mjs').then(m=>console.log(m.token({role:'anon'})))")
VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_ANON_KEY=$ANON npx vite build --outDir dist-e2e >/dev/null
npx vite preview --outDir dist-e2e --port 4173 >/dev/null 2>&1 & PID_WEB=$!
trap 'kill $PID_API $PID_WEB 2>/dev/null' EXIT
sleep 3
mkdir -p $RAIZ/docs/telas
{
  echo "Executado em: $(date '+%d/%m/%Y %H:%M')"
  echo; echo "== Tela Hoje =="; SAIDA=$RAIZ/docs/telas node e2e/teste_hoje.mjs || true
  echo; echo "== Cadastro de crianças e responsáveis =="; SAIDA=$RAIZ/docs/telas node e2e/teste_criancas.mjs || true
  bash $RAIZ/local/montar_banco.sh >/dev/null   # financeiro começa de um banco limpo
  echo; echo "== Financeiro e pagamento por Pix =="; SAIDA=$RAIZ/docs/telas node e2e/teste_financeiro.mjs || true
  bash $RAIZ/local/montar_banco.sh >/dev/null
  echo; echo "== Escolha de perfil e cadastro da família =="; SAIDA=$RAIZ/docs/telas node e2e/teste_cadastro.mjs || true
  bash $RAIZ/local/montar_banco.sh >/dev/null
  echo; echo "== Rotina da família, comunicados e mensagens =="; SAIDA=$RAIZ/docs/telas node e2e/teste_comunicacao.mjs || true
  echo; echo "== Avisos no celular =="; SAIDA=$RAIZ/docs/telas node e2e/teste_avisos.mjs || true
  echo; echo "== Esqueci minha senha =="; SAIDA=$RAIZ/docs/telas node e2e/teste_senha.mjs || true
  echo; echo "== App instalável no celular (PWA) =="; SAIDA=$RAIZ/docs/telas node e2e/teste_pwa.mjs || true
} | tee $RAIZ/docs/resultado_testes_telas.txt
