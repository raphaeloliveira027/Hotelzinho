-- =====================================================================
-- SOMENTE PARA AMBIENTE LOCAL (PostgreSQL puro).
-- Simula o mínimo do Supabase: schema auth, tabela auth.users,
-- função auth.uid() e os papéis anon/authenticated.
-- NÃO rode este arquivo no Supabase: lá isso já existe.
-- =====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id    UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  raw_user_meta_data JSONB   -- dados enviados no cadastro pelo app (supabase.auth.signUp)
);

-- No Supabase, auth.uid() lê o "sub" do token JWT do usuário logado.
-- Aqui lemos de uma variável de sessão que os testes preenchem
-- (ou do token, quando o acesso vem pelo PostgREST, como no Supabase).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Storage mínimo (só para rodar a migração 0005 e testar as regras de acesso)
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY, name TEXT, public BOOLEAN, file_size_limit BIGINT, allowed_mime_types TEXT[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT REFERENCES storage.buckets(id),
  name TEXT NOT NULL,
  owner UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
GRANT USAGE ON SCHEMA storage TO anon, authenticated;
GRANT SELECT, INSERT ON storage.objects TO authenticated;

-- Papel do servidor (as funções do Supabase usam este papel com a chave secreta)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO service_role;

-- pg_net mínimo: no Supabase, net.http_post faz a chamada HTTP depois do COMMIT.
-- Aqui só anota o pedido, para os testes conferirem que o aviso foi disparado.
CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS net.pedidos (id BIGSERIAL PRIMARY KEY, url TEXT, body JSONB, headers JSONB, em TIMESTAMPTZ DEFAULT now());
CREATE OR REPLACE FUNCTION net.http_post(url TEXT, body JSONB DEFAULT '{}', params JSONB DEFAULT '{}',
  headers JSONB DEFAULT '{"Content-Type": "application/json"}', timeout_milliseconds INT DEFAULT 5000)
RETURNS BIGINT LANGUAGE sql AS $$
  INSERT INTO net.pedidos (url, body, headers) VALUES (url, body, headers) RETURNING id
$$;
