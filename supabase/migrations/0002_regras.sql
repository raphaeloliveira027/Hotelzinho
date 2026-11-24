-- =====================================================================
-- Migration 0002: funções de apoio, status calculado, regras de negócio
-- e gatilhos (notificações, auditoria, calendário)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funções de apoio usadas pelas políticas de acesso (RLS)
-- SECURITY DEFINER: leem as tabelas sem cair em recursão de RLS.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.eh_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuario
    WHERE id = auth.uid() AND perfil = 'ADMIN' AND ativo
  )
$$;

CREATE OR REPLACE FUNCTION public.meu_responsavel_id() RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id FROM responsavel r
  JOIN usuario u ON u.id = r.usuario_id
  WHERE r.usuario_id = auth.uid() AND u.ativo
$$;

-- Crianças vinculadas ao responsável logado
CREATE OR REPLACE FUNCTION public.minhas_criancas() RETURNS SETOF BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cr.crianca_id
  FROM crianca_responsavel cr
  WHERE cr.responsavel_id = public.meu_responsavel_id()
$$;

-- Novo usuário do Auth vira linha em "usuario" SEMPRE como RESPONSAVEL.
-- Promover a ADMIN é feito manualmente (nunca pelo cadastro).
CREATE OR REPLACE FUNCTION public.ao_criar_usuario_auth() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO usuario (id, email, perfil) VALUES (NEW.id, NEW.email, 'RESPONSAVEL')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_auth_novo_usuario
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.ao_criar_usuario_auth();

-- ---------------------------------------------------------------------
-- Status da mensalidade: calculado, nunca gravado
-- security_invoker = a view respeita o RLS de quem consulta
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_mensalidade_status
WITH (security_invoker = true) AS
SELECT
  m.*,
  COALESCE(p.total_pago, 0) AS total_pago,
  GREATEST(m.valor_final - COALESCE(p.total_pago, 0), 0) AS valor_em_aberto,
  CASE
    WHEN m.cancelada THEN 'CANCELADA'
    WHEN COALESCE(p.total_pago, 0) >= m.valor_final THEN 'PAGO'
    WHEN EXISTS (SELECT 1 FROM comprovante c
                 WHERE c.mensalidade_id = m.id AND c.status = 'PENDENTE') THEN 'EM_ANALISE'
    WHEN CURRENT_DATE > m.data_vencimento THEN 'ATRASADO'
    ELSE 'PENDENTE'
  END AS status
FROM mensalidade m
LEFT JOIN (
  SELECT mensalidade_id, SUM(valor_pago) AS total_pago
  FROM pagamento GROUP BY mensalidade_id
) p ON p.mensalidade_id = m.id;

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_log(p_acao TEXT, p_entidade TEXT, p_id TEXT, p_det JSONB)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO log_auditoria (usuario_id, acao, entidade, entidade_id, detalhes)
  VALUES (auth.uid(), p_acao, p_entidade, p_id, p_det)
$$;

-- Mudanças em dados de saúde/cuidado da criança ficam registradas
CREATE OR REPLACE FUNCTION public.log_saude_crianca() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.atualizado_em := now();
  IF NEW.alergias IS DISTINCT FROM OLD.alergias
     OR NEW.restricoes_alimentares IS DISTINCT FROM OLD.restricoes_alimentares
     OR NEW.info_saude IS DISTINCT FROM OLD.info_saude THEN
    PERFORM registrar_log('ALTERAR_SAUDE', 'crianca', NEW.id::text, NULL);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_crianca_saude
BEFORE UPDATE ON crianca
FOR EACH ROW EXECUTE FUNCTION public.log_saude_crianca();

-- ---------------------------------------------------------------------
-- Calendário: presença não pode ser registrada em feriado
-- (fim de semana já é bloqueado pelo CHECK da tabela)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.valida_presenca() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM feriado f WHERE f.data = NEW.data) THEN
    RAISE EXCEPTION 'O hotelzinho não funciona em feriados (%).', NEW.data
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_presenca_feriado
BEFORE INSERT OR UPDATE OF data ON presenca
FOR EACH ROW EXECUTE FUNCTION public.valida_presenca();

-- ---------------------------------------------------------------------
-- Notificações automáticas
-- ---------------------------------------------------------------------
-- Envia uma notificação para todos os usuários responsáveis por uma criança
CREATE OR REPLACE FUNCTION public.notificar_familia(p_crianca BIGINT, p_tipo TEXT, p_texto TEXT, p_link TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO notificacao (usuario_id, tipo, texto, link)
  SELECT r.usuario_id, p_tipo, p_texto, p_link
  FROM crianca_responsavel cr
  JOIN responsavel r ON r.id = cr.responsavel_id
  WHERE cr.crianca_id = p_crianca AND r.usuario_id IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.notificar_admins(p_tipo TEXT, p_texto TEXT, p_link TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO notificacao (usuario_id, tipo, texto, link)
  SELECT id, p_tipo, p_texto, p_link FROM usuario WHERE perfil = 'ADMIN' AND ativo
$$;

-- Ocorrência visível aos pais → aviso imediato à família
CREATE OR REPLACE FUNCTION public.ao_registrar_rotina() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tipo = 'OCORRENCIA' AND NEW.visivel_pais THEN
    PERFORM notificar_familia(NEW.crianca_id, 'OCORRENCIA',
      'Nova ocorrência registrada. Toque para ver.', '/familia/rotina');
  ELSIF NEW.tipo = 'RECADO' AND NEW.visivel_pais THEN
    PERFORM notificar_familia(NEW.crianca_id, 'RECADO',
      'Você recebeu um recado do hotelzinho.', '/familia/rotina');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_rotina_notifica
AFTER INSERT ON registro_rotina
FOR EACH ROW EXECUTE FUNCTION public.ao_registrar_rotina();

-- Comunicado geral → todas as famílias; individual → família da criança
CREATE OR REPLACE FUNCTION public.ao_publicar_comunicado() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.crianca_id IS NULL THEN
    INSERT INTO notificacao (usuario_id, tipo, texto, link)
    SELECT id, 'COMUNICADO', left('Novo comunicado: ' || NEW.titulo, 255), '/familia'
    FROM usuario WHERE perfil = 'RESPONSAVEL' AND ativo;
  ELSE
    PERFORM notificar_familia(NEW.crianca_id, 'COMUNICADO',
      left('Novo comunicado: ' || NEW.titulo, 255), '/familia');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_comunicado_notifica
AFTER INSERT ON comunicado
FOR EACH ROW EXECUTE FUNCTION public.ao_publicar_comunicado();

-- Comprovante enviado → administradora é avisada
CREATE OR REPLACE FUNCTION public.ao_enviar_comprovante() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM notificar_admins('COMPROVANTE', 'Novo comprovante para analisar.',
    '/admin/comprovantes/' || NEW.id);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_comprovante_notifica
AFTER INSERT ON comprovante
FOR EACH ROW EXECUTE FUNCTION public.ao_enviar_comprovante();

-- ---------------------------------------------------------------------
-- Regras de negócio chamadas pelo app (RPC)
-- ---------------------------------------------------------------------

-- Gera as mensalidades do mês para todas as crianças ativas com plano.
-- O valor do plano é COPIADO (se o preço mudar, o histórico não muda).
CREATE OR REPLACE FUNCTION public.gerar_mensalidades(p_competencia DATE)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_comp DATE := date_trunc('month', p_competencia)::date;
  v_qtd  INTEGER;
BEGIN
  IF NOT eh_admin() THEN
    RAISE EXCEPTION 'Apenas a administração pode gerar mensalidades.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO mensalidade (crianca_id, competencia, valor_base, data_vencimento)
  SELECT c.id, v_comp, p.valor, (v_comp + INTERVAL '1 month' - INTERVAL '1 day')::date
  FROM crianca c JOIN plano p ON p.id = c.plano_id
  WHERE c.status IN ('ATIVA', 'EM_ADAPTACAO')
  ON CONFLICT (crianca_id, competencia) DO NOTHING;

  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  PERFORM registrar_log('GERAR_MENSALIDADES', 'mensalidade', to_char(v_comp, 'YYYY-MM'),
                        jsonb_build_object('quantidade', v_qtd));
  RETURN v_qtd;
END $$;

-- A administradora confirma um comprovante depois de conferir o extrato.
CREATE OR REPLACE FUNCTION public.confirmar_comprovante(p_comprovante BIGINT, p_data_pagamento DATE DEFAULT CURRENT_DATE)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_comp  comprovante%ROWTYPE;
  v_mens  vw_mensalidade_status%ROWTYPE;
  v_pag   BIGINT;
BEGIN
  IF NOT eh_admin() THEN
    RAISE EXCEPTION 'Apenas a administração confirma pagamentos.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_comp FROM comprovante WHERE id = p_comprovante FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comprovante não encontrado.'; END IF;
  IF v_comp.status <> 'PENDENTE' THEN
    RAISE EXCEPTION 'Este comprovante já foi analisado.';
  END IF;

  SELECT * INTO v_mens FROM vw_mensalidade_status WHERE id = v_comp.mensalidade_id;

  UPDATE comprovante
     SET status = 'ACEITO', analisado_por = auth.uid(), analisado_em = now()
   WHERE id = p_comprovante;

  INSERT INTO pagamento (mensalidade_id, comprovante_id, valor_pago, data_pagamento, forma, confirmado_por)
  VALUES (v_comp.mensalidade_id, p_comprovante, v_mens.valor_em_aberto, p_data_pagamento, 'PIX', auth.uid())
  RETURNING id INTO v_pag;

  PERFORM registrar_log('CONFIRMAR_PAGAMENTO', 'pagamento', v_pag::text,
          jsonb_build_object('mensalidade', v_comp.mensalidade_id, 'valor', v_mens.valor_em_aberto));
  PERFORM notificar_familia(v_mens.crianca_id, 'COMPROVANTE',
          'Pagamento confirmado. Obrigado!', '/familia/mensalidades');
  RETURN v_pag;
END $$;

CREATE OR REPLACE FUNCTION public.recusar_comprovante(p_comprovante BIGINT, p_motivo TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_crianca BIGINT;
BEGIN
  IF NOT eh_admin() THEN
    RAISE EXCEPTION 'Apenas a administração analisa comprovantes.' USING ERRCODE = '42501';
  END IF;
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo da recusa.';
  END IF;

  UPDATE comprovante
     SET status = 'RECUSADO', motivo_recusa = p_motivo,
         analisado_por = auth.uid(), analisado_em = now()
   WHERE id = p_comprovante AND status = 'PENDENTE';
  IF NOT FOUND THEN RAISE EXCEPTION 'Comprovante não encontrado ou já analisado.'; END IF;

  SELECT m.crianca_id INTO v_crianca
  FROM comprovante c JOIN mensalidade m ON m.id = c.mensalidade_id WHERE c.id = p_comprovante;

  PERFORM registrar_log('RECUSAR_COMPROVANTE', 'comprovante', p_comprovante::text,
          jsonb_build_object('motivo', p_motivo));
  PERFORM notificar_familia(v_crianca, 'COMPROVANTE',
          left('Comprovante recusado: ' || p_motivo, 255), '/familia/mensalidades');
END $$;

-- O responsável atualiza apenas os próprios dados de contato.
CREATE OR REPLACE FUNCTION public.atualizar_meu_contato(
  p_telefone TEXT, p_telefone_alt TEXT, p_email TEXT, p_endereco TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id BIGINT := meu_responsavel_id();
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'Usuário não é um responsável cadastrado.' USING ERRCODE = '42501'; END IF;
  UPDATE responsavel
     SET telefone = p_telefone, telefone_alt = NULLIF(p_telefone_alt, ''),
         email = NULLIF(p_email, ''), endereco = NULLIF(p_endereco, '')
   WHERE id = v_id;
END $$;

-- Registra o aceite do termo de privacidade (LGPD) pelo responsável.
CREATE OR REPLACE FUNCTION public.aceitar_termo()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id BIGINT := meu_responsavel_id();
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'Usuário não é um responsável cadastrado.' USING ERRCODE = '42501'; END IF;
  UPDATE responsavel
     SET consentimento_em = now(),
         versao_termo = (SELECT versao_termo FROM configuracao LIMIT 1)
   WHERE id = v_id;
  PERFORM registrar_log('ACEITAR_TERMO', 'responsavel', v_id::text, NULL);
END $$;
