-- =====================================================================
-- Migration 0008: a família cadastra a criança junto com o próprio cadastro
-- e a administração autoriza também a criança.
--
--  - No autocadastro, a família informa os dados de cada criança (nome, data de
--    nascimento, período desejado e, se quiser, alergias, restrições e saúde).
--  - Esses dados ficam só na solicitação: NENHUMA criança é criada sem a administração.
--  - Ao aprovar, a administradora decide, para cada criança: cadastrar como nova
--    (podendo corrigir os dados e escolher o plano), ligar a uma criança que já existe,
--    ou não aprovar aquela criança.
-- =====================================================================

ALTER TABLE solicitacao_cadastro ADD COLUMN IF NOT EXISTS criancas_dados JSONB;

-- Limpa o que veio do formulário: no máximo 5 crianças, só os campos conhecidos,
-- textos com tamanho limitado e data no formato AAAA-MM-DD.
CREATE OR REPLACE FUNCTION public.limpar_criancas_cadastro(j JSONB) RETURNS JSONB
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(j) <> 'array' THEN NULL ELSE (
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'nome',       left(NULLIF(trim(e ->> 'nome'), ''), 150),
             'nascimento', CASE WHEN (e ->> 'nascimento') ~ '^\d{4}-\d{2}-\d{2}$' THEN e ->> 'nascimento' END,
             'turno',      CASE WHEN e ->> 'turno' IN ('MANHA', 'TARDE', 'INTEGRAL') THEN e ->> 'turno' END,
             'alergias',   left(NULLIF(trim(e ->> 'alergias'), ''), 500),
             'restricoes', left(NULLIF(trim(e ->> 'restricoes'), ''), 500),
             'saude',      left(NULLIF(trim(e ->> 'saude'), ''), 500)))
           ORDER BY n)
      FROM jsonb_array_elements(j) WITH ORDINALITY AS t(e, n)
     WHERE n <= 5 AND jsonb_typeof(e) = 'object' AND length(trim(COALESCE(e ->> 'nome', ''))) >= 3
  ) END
$$;

-- Novo login pelo app: igual à 0006, agora guardando também os dados das crianças.
CREATE OR REPLACE FUNCTION public.ao_criar_usuario_auth() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  pelo_app BOOLEAN := COALESCE(m ->> 'origem', '') = 'app';
  v_criancas JSONB;
BEGIN
  INSERT INTO usuario (id, email, perfil, ativo)
  VALUES (NEW.id, NEW.email, 'RESPONSAVEL', NOT pelo_app)
  ON CONFLICT (id) DO NOTHING;

  IF pelo_app THEN
    v_criancas := limpar_criancas_cadastro(m -> 'criancas_dados');
    INSERT INTO solicitacao_cadastro (usuario_id, nome, telefone, email, criancas_texto, criancas_dados, parentesco, aceite_termo_em)
    VALUES (NEW.id,
            left(COALESCE(NULLIF(trim(m ->> 'nome'), ''), NEW.email), 150),
            left(COALESCE(m ->> 'telefone', ''), 20),
            NEW.email,
            left(COALESCE(NULLIF(m ->> 'criancas', ''),
                          (SELECT string_agg(e ->> 'nome', ', ') FROM jsonb_array_elements(v_criancas) e)), 300),
            v_criancas,
            left(m ->> 'parentesco', 40),
            CASE WHEN (m ->> 'aceite_termo') = 'true' THEN now() END)
    ON CONFLICT (usuario_id) DO NOTHING;
    PERFORM notificar_admins('CADASTRO', left('Novo cadastro para aprovar: ' || COALESCE(m ->> 'nome', NEW.email), 255),
                             '/admin/solicitacoes');
  END IF;
  RETURN NEW;
END $$;

-- Aprovação com decisão por criança.
-- p_criancas: lista de decisões, por exemplo
--   [{"acao":"NOVA","nome":"Ana Lima","nascimento":"2022-03-10","plano_id":1,"status":"EM_ADAPTACAO",
--     "alergias":"…","restricoes":"…","saude":"…"},
--    {"acao":"EXISTENTE","crianca_id":7}]
-- Criança que a administradora não aprovou simplesmente não entra na lista.
DROP FUNCTION IF EXISTS public.aprovar_cadastro(BIGINT, BIGINT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN);

CREATE OR REPLACE FUNCTION public.aprovar_cadastro(
  p_solicitacao BIGINT, p_criancas JSONB DEFAULT '[]'::jsonb, p_parentesco TEXT DEFAULT NULL,
  p_financeiro BOOLEAN DEFAULT FALSE, p_buscar BOOLEAN DEFAULT TRUE, p_emergencia BOOLEAN DEFAULT FALSE)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s solicitacao_cadastro%ROWTYPE;
  v_resp BIGINT;
  d JSONB;
  v_crianca BIGINT;
  v_nasc DATE;
  v_status status_crianca;
  v_ids BIGINT[] := '{}';
  v_nomes TEXT[] := '{}';
BEGIN
  IF NOT eh_admin() THEN
    RAISE EXCEPTION 'Apenas a administração aprova cadastros.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM solicitacao_cadastro WHERE id = p_solicitacao FOR UPDATE;
  IF NOT FOUND OR s.status <> 'PENDENTE' THEN
    RAISE EXCEPTION 'Solicitação não encontrada ou já analisada.';
  END IF;
  p_criancas := COALESCE(p_criancas, '[]'::jsonb);
  IF jsonb_typeof(p_criancas) <> 'array' THEN
    RAISE EXCEPTION 'Lista de crianças inválida.';
  END IF;
  IF jsonb_array_length(p_criancas) > 0 AND (p_parentesco IS NULL OR length(trim(p_parentesco)) < 2) THEN
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

  FOR d IN SELECT * FROM jsonb_array_elements(p_criancas) LOOP
    IF d ->> 'acao' = 'EXISTENTE' THEN
      SELECT id INTO v_crianca FROM crianca WHERE id = (d ->> 'crianca_id')::bigint;
      IF v_crianca IS NULL THEN RAISE EXCEPTION 'Criança escolhida não encontrada.'; END IF;

    ELSIF d ->> 'acao' = 'NOVA' THEN
      IF length(trim(COALESCE(d ->> 'nome', ''))) < 3 THEN
        RAISE EXCEPTION 'Informe o nome completo da criança.';
      END IF;
      BEGIN
        v_nasc := (d ->> 'nascimento')::date;
      EXCEPTION WHEN others THEN v_nasc := NULL;
      END;
      IF v_nasc IS NULL OR v_nasc > CURRENT_DATE THEN
        RAISE EXCEPTION 'Data de nascimento inválida para %.', trim(d ->> 'nome');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM plano WHERE id = (d ->> 'plano_id')::bigint AND ativo) THEN
        RAISE EXCEPTION 'Escolha o plano de %.', trim(d ->> 'nome');
      END IF;
      v_status := CASE WHEN d ->> 'status' = 'EM_ADAPTACAO' THEN 'EM_ADAPTACAO' ELSE 'ATIVA' END;
      INSERT INTO crianca (nome_completo, data_nascimento, status, plano_id, alergias, restricoes_alimentares, info_saude)
      VALUES (left(trim(d ->> 'nome'), 150), v_nasc, v_status, (d ->> 'plano_id')::bigint,
              NULLIF(trim(d ->> 'alergias'), ''), NULLIF(trim(d ->> 'restricoes'), ''), NULLIF(trim(d ->> 'saude'), ''))
      RETURNING id INTO v_crianca;

    ELSE
      RAISE EXCEPTION 'Decisão inválida para uma das crianças.';
    END IF;

    INSERT INTO crianca_responsavel (crianca_id, responsavel_id, parentesco, eh_financeiro, autorizado_buscar, contato_emergencia)
    VALUES (v_crianca, v_resp, trim(p_parentesco), p_financeiro, p_buscar, p_emergencia)
    ON CONFLICT (crianca_id, responsavel_id) DO NOTHING;
    v_ids := v_ids || v_crianca;
    v_nomes := v_nomes || (SELECT split_part(nome_completo, ' ', 1) FROM crianca WHERE id = v_crianca);
  END LOOP;

  UPDATE usuario SET ativo = TRUE WHERE id = s.usuario_id;
  UPDATE solicitacao_cadastro SET status = 'ACEITO', analisado_por = auth.uid(), analisado_em = now() WHERE id = s.id;
  PERFORM registrar_log('APROVAR_CADASTRO', 'solicitacao_cadastro', s.id::text,
          jsonb_build_object('responsavel', v_resp, 'criancas', to_jsonb(v_ids)));
  INSERT INTO notificacao (usuario_id, tipo, texto, link)
  VALUES (s.usuario_id, 'CADASTRO',
          left(CASE WHEN cardinality(v_nomes) = 0 THEN 'Seu cadastro foi aprovado. Bem-vindo(a)!'
                    ELSE 'Seu cadastro foi aprovado, com ' || array_to_string(v_nomes, ', ') || '. Bem-vindo(a)!' END, 255),
          '/familia');
  RETURN v_resp;
END $$;

REVOKE EXECUTE ON FUNCTION public.aprovar_cadastro(BIGINT, JSONB, TEXT, BOOLEAN, BOOLEAN, BOOLEAN),
  public.limpar_criancas_cadastro(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aprovar_cadastro(BIGINT, JSONB, TEXT, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;
