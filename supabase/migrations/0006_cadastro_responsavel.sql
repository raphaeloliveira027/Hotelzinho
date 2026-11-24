-- =====================================================================
-- Migration 0006:
--  1) Telefone brasileiro válido: (DDD) 9XXXX-XXXX (celular) ou (DDD) XXXX-XXXX (fixo),
--     com DDD existente.
--  2) Autocadastro do responsável: a pessoa cria a conta pelo app, a conta nasce
--     INATIVA (sem acesso a nenhum dado) e vira uma solicitação para a administração
--     aprovar ou recusar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Telefone
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.telefone_valido(p TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT p ~ '^\([1-9][1-9]\) (9[0-9]{4}|[2-5][0-9]{3})-[0-9]{4}$'
     AND substring(p FROM 2 FOR 2)::int IN (
       11,12,13,14,15,16,17,18,19, 21,22,24,27,28, 31,32,33,34,35,37,38,
       41,42,43,44,45,46,47,48,49, 51,53,54,55, 61,62,63,64,65,66,67,68,69,
       71,73,74,75,77,79, 81,82,83,84,85,86,87,88,89, 91,92,93,94,95,96,97,98,99)
$$;

-- NOT VALID: vale para todo cadastro novo ou alterado, sem travar dados antigos
ALTER TABLE responsavel
  ADD CONSTRAINT ck_responsavel_telefone_br CHECK (telefone_valido(telefone)) NOT VALID,
  ADD CONSTRAINT ck_responsavel_telefone_alt_br CHECK (telefone_alt IS NULL OR telefone_valido(telefone_alt)) NOT VALID;

-- ---------------------------------------------------------------------
-- 2) Solicitações de cadastro
-- ---------------------------------------------------------------------
CREATE TABLE solicitacao_cadastro (
  id              BIGSERIAL PRIMARY KEY,
  usuario_id      UUID NOT NULL UNIQUE REFERENCES usuario(id) ON DELETE CASCADE,
  nome            VARCHAR(150) NOT NULL,
  telefone        VARCHAR(20)  NOT NULL,
  email           VARCHAR(255) NOT NULL,
  criancas_texto  VARCHAR(300),           -- nome da(s) criança(s), escrito pela família
  parentesco      VARCHAR(40),
  aceite_termo_em TIMESTAMPTZ,
  status          status_analise NOT NULL DEFAULT 'PENDENTE',
  motivo_recusa   TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  analisado_por   UUID REFERENCES usuario(id),
  analisado_em    TIMESTAMPTZ,
  CHECK (status <> 'RECUSADO' OR motivo_recusa IS NOT NULL)
);

ALTER TABLE solicitacao_cadastro ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON solicitacao_cadastro TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE solicitacao_cadastro_id_seq TO authenticated;
CREATE POLICY admin_le ON solicitacao_cadastro FOR SELECT TO authenticated USING (eh_admin());
CREATE POLICY dono_le  ON solicitacao_cadastro FOR SELECT TO authenticated USING (usuario_id = auth.uid());

-- Novo login: quem se cadastrou pelo app (origem = 'app') nasce inativo e vira solicitação.
-- Logins criados pela administração no painel do Supabase continuam ativos, como antes.
-- O perfil é SEMPRE RESPONSAVEL: nada que a pessoa envie no cadastro muda isso.
CREATE OR REPLACE FUNCTION public.ao_criar_usuario_auth() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  pelo_app BOOLEAN := COALESCE(m ->> 'origem', '') = 'app';
BEGIN
  INSERT INTO usuario (id, email, perfil, ativo)
  VALUES (NEW.id, NEW.email, 'RESPONSAVEL', NOT pelo_app)
  ON CONFLICT (id) DO NOTHING;

  IF pelo_app THEN
    INSERT INTO solicitacao_cadastro (usuario_id, nome, telefone, email, criancas_texto, parentesco, aceite_termo_em)
    VALUES (NEW.id,
            left(COALESCE(NULLIF(trim(m ->> 'nome'), ''), NEW.email), 150),
            left(COALESCE(m ->> 'telefone', ''), 20),
            NEW.email,
            left(m ->> 'criancas', 300),
            left(m ->> 'parentesco', 40),
            CASE WHEN (m ->> 'aceite_termo') = 'true' THEN now() END)
    ON CONFLICT (usuario_id) DO NOTHING;
    PERFORM notificar_admins('CADASTRO', left('Novo cadastro para aprovar: ' || COALESCE(m ->> 'nome', NEW.email), 255),
                             '/admin/solicitacoes');
  END IF;
  RETURN NEW;
END $$;

-- A administradora aprova: ativa a conta, cria (ou reaproveita) o cadastro de responsável
-- e, se escolher, já vincula a uma criança.
CREATE OR REPLACE FUNCTION public.aprovar_cadastro(
  p_solicitacao BIGINT, p_crianca BIGINT DEFAULT NULL, p_parentesco TEXT DEFAULT NULL,
  p_financeiro BOOLEAN DEFAULT FALSE, p_buscar BOOLEAN DEFAULT TRUE, p_emergencia BOOLEAN DEFAULT FALSE)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s solicitacao_cadastro%ROWTYPE;
  v_resp BIGINT;
BEGIN
  IF NOT eh_admin() THEN
    RAISE EXCEPTION 'Apenas a administração aprova cadastros.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM solicitacao_cadastro WHERE id = p_solicitacao FOR UPDATE;
  IF NOT FOUND OR s.status <> 'PENDENTE' THEN
    RAISE EXCEPTION 'Solicitação não encontrada ou já analisada.';
  END IF;
  IF p_crianca IS NOT NULL AND (p_parentesco IS NULL OR length(trim(p_parentesco)) < 2) THEN
    RAISE EXCEPTION 'Informe o parentesco com a criança.';
  END IF;

  -- Responsável já ligado a este login (ex.: cadastrado antes pela administração com o mesmo e-mail)?
  SELECT id INTO v_resp FROM responsavel WHERE usuario_id = s.usuario_id;
  IF v_resp IS NULL THEN
    IF NOT telefone_valido(s.telefone) THEN
      RAISE EXCEPTION 'O telefone informado no cadastro é inválido. Peça para a família corrigir ou cadastre o responsável manualmente.';
    END IF;
    INSERT INTO responsavel (usuario_id, nome, telefone, email, consentimento_em, versao_termo)
    VALUES (s.usuario_id, s.nome, s.telefone, s.email, s.aceite_termo_em,
            CASE WHEN s.aceite_termo_em IS NOT NULL THEN (SELECT versao_termo FROM configuracao LIMIT 1) END)
    RETURNING id INTO v_resp;
  END IF;

  IF p_crianca IS NOT NULL THEN
    INSERT INTO crianca_responsavel (crianca_id, responsavel_id, parentesco, eh_financeiro, autorizado_buscar, contato_emergencia)
    VALUES (p_crianca, v_resp, trim(p_parentesco), p_financeiro, p_buscar, p_emergencia)
    ON CONFLICT (crianca_id, responsavel_id) DO NOTHING;
  END IF;

  UPDATE usuario SET ativo = TRUE WHERE id = s.usuario_id;
  UPDATE solicitacao_cadastro SET status = 'ACEITO', analisado_por = auth.uid(), analisado_em = now() WHERE id = s.id;
  PERFORM registrar_log('APROVAR_CADASTRO', 'solicitacao_cadastro', s.id::text,
          jsonb_build_object('responsavel', v_resp, 'crianca', p_crianca));
  INSERT INTO notificacao (usuario_id, tipo, texto, link)
  VALUES (s.usuario_id, 'CADASTRO', 'Seu cadastro foi aprovado. Bem-vindo(a)!', '/familia');
  RETURN v_resp;
END $$;

CREATE OR REPLACE FUNCTION public.recusar_cadastro(p_solicitacao BIGINT, p_motivo TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT eh_admin() THEN
    RAISE EXCEPTION 'Apenas a administração analisa cadastros.' USING ERRCODE = '42501';
  END IF;
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo da recusa.';
  END IF;
  UPDATE solicitacao_cadastro
     SET status = 'RECUSADO', motivo_recusa = trim(p_motivo), analisado_por = auth.uid(), analisado_em = now()
   WHERE id = p_solicitacao AND status = 'PENDENTE';
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada ou já analisada.'; END IF;
  PERFORM registrar_log('RECUSAR_CADASTRO', 'solicitacao_cadastro', p_solicitacao::text,
          jsonb_build_object('motivo', trim(p_motivo)));
END $$;

REVOKE EXECUTE ON FUNCTION public.ao_criar_usuario_auth(), public.aprovar_cadastro(BIGINT, BIGINT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN),
  public.recusar_cadastro(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aprovar_cadastro(BIGINT, BIGINT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN),
  public.recusar_cadastro(BIGINT, TEXT), public.telefone_valido(TEXT) TO authenticated;
