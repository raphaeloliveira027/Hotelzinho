-- =====================================================================
-- 0010 — Cobrança automática, edição de valor e exclusão de cobrança
--   * configuracao.cobranca_automatica: se ligada, o sistema gera sozinho as
--     mensalidades do mês (uma vez por mês, todo dia às 06:00 confere).
--   * editar_mensalidade: a administração muda o valor de uma cobrança, com motivo.
--   * excluir_mensalidade: a administração apaga uma cobrança feita errada
--     (só se não tiver pagamento nem comprovante em análise ou aceito).
--   * mensalidade.observacao: motivo do ajuste, visível para a família.
-- =====================================================================

ALTER TABLE configuracao ADD COLUMN IF NOT EXISTS cobranca_automatica BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE mensalidade ADD COLUMN IF NOT EXISTS observacao VARCHAR(200);

-- A view lista as colunas na mesma ordem de antes e acrescenta "observacao" no fim
CREATE OR REPLACE VIEW vw_mensalidade_status
WITH (security_invoker = true) AS
SELECT
  m.id, m.crianca_id, m.competencia, m.valor_base, m.desconto, m.valor_final,
  m.data_vencimento, m.cancelada,
  COALESCE(p.total_pago, 0) AS total_pago,
  GREATEST(m.valor_final - COALESCE(p.total_pago, 0), 0) AS valor_em_aberto,
  CASE
    WHEN m.cancelada THEN 'CANCELADA'
    WHEN COALESCE(p.total_pago, 0) >= m.valor_final THEN 'PAGO'
    WHEN EXISTS (SELECT 1 FROM comprovante c
                 WHERE c.mensalidade_id = m.id AND c.status = 'PENDENTE') THEN 'EM_ANALISE'
    WHEN CURRENT_DATE > m.data_vencimento THEN 'ATRASADO'
    ELSE 'PENDENTE'
  END AS status,
  m.observacao
FROM mensalidade m
LEFT JOIN (
  SELECT mensalidade_id, SUM(valor_pago) AS total_pago
  FROM pagamento GROUP BY mensalidade_id
) p ON p.mensalidade_id = m.id;

-- Valor em reais no formato brasileiro, para os avisos
CREATE OR REPLACE FUNCTION public.reais(v NUMERIC)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT 'R$ ' || replace(replace(replace(to_char(v, 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.')
$$;

CREATE OR REPLACE FUNCTION public.mes_ano(d DATE)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT (ARRAY['janeiro','fevereiro','março','abril','maio','junho','julho','agosto',
                'setembro','outubro','novembro','dezembro'])[EXTRACT(MONTH FROM d)::int]
         || '/' || EXTRACT(YEAR FROM d)::int
$$;

-- ---------------------------------------------------------------------
-- Geração das mensalidades
-- ---------------------------------------------------------------------
-- Parte comum (sem conferir quem chama): usada pelo botão e pela cobrança automática
CREATE OR REPLACE FUNCTION public.criar_mensalidades(p_competencia DATE)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_comp DATE := date_trunc('month', p_competencia)::date;
  v_qtd  INTEGER;
BEGIN
  INSERT INTO mensalidade (crianca_id, competencia, valor_base, data_vencimento)
  SELECT c.id, v_comp, p.valor, (v_comp + INTERVAL '1 month' - INTERVAL '1 day')::date
  FROM crianca c JOIN plano p ON p.id = c.plano_id
  WHERE c.status IN ('ATIVA', 'EM_ADAPTACAO')
  ON CONFLICT (crianca_id, competencia) DO NOTHING;
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  RETURN v_qtd;
END $$;

-- Botão "Gerar mensalidades" (só a administração)
CREATE OR REPLACE FUNCTION public.gerar_mensalidades(p_competencia DATE)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_comp DATE := date_trunc('month', p_competencia)::date;
  v_qtd  INTEGER;
BEGIN
  IF NOT eh_admin() THEN
    RAISE EXCEPTION 'Apenas a administração pode gerar mensalidades.' USING ERRCODE = '42501';
  END IF;
  v_qtd := criar_mensalidades(v_comp);
  PERFORM registrar_log('GERAR_MENSALIDADES', 'mensalidade', to_char(v_comp, 'YYYY-MM'),
                        jsonb_build_object('quantidade', v_qtd));
  RETURN v_qtd;
END $$;

-- Cobrança automática: gera o mês atual UMA vez (não recria cobranças excluídas depois).
-- Chamada todo dia pelo agendador (pg_cron) e também quando a administração liga a opção.
CREATE OR REPLACE FUNCTION public.gerar_mensalidades_automatico()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_comp DATE := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  v_qtd  INTEGER;
BEGIN
  IF NOT COALESCE((SELECT cobranca_automatica FROM configuracao LIMIT 1), FALSE) THEN
    RETURN 0;
  END IF;
  IF (SELECT valor FROM config_sistema WHERE chave = 'ultima_cobranca_automatica') = to_char(v_comp, 'YYYY-MM') THEN
    RETURN 0;
  END IF;

  v_qtd := criar_mensalidades(v_comp);
  INSERT INTO config_sistema (chave, valor) VALUES ('ultima_cobranca_automatica', to_char(v_comp, 'YYYY-MM'))
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;
  PERFORM registrar_log('GERAR_MENSALIDADES_AUTO', 'mensalidade', to_char(v_comp, 'YYYY-MM'),
                        jsonb_build_object('quantidade', v_qtd));
  IF v_qtd > 0 THEN
    PERFORM notificar_admins('MENSALIDADE',
      v_qtd || ' mensalidade' || CASE WHEN v_qtd = 1 THEN '' ELSE 's' END || ' de ' || mes_ano(v_comp)
      || CASE WHEN v_qtd = 1 THEN ' gerada' ELSE ' geradas' END || ' automaticamente.',
      '/admin/financeiro');
  END IF;
  RETURN v_qtd;
END $$;

-- Liga/desliga a cobrança automática. Ao ligar, já gera o mês atual (se ainda não gerou).
CREATE OR REPLACE FUNCTION public.definir_cobranca_automatica(p_ligada BOOLEAN)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_qtd INTEGER := 0;
BEGIN
  IF NOT eh_admin() THEN
    RAISE EXCEPTION 'Apenas a administração muda a forma de cobrança.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO configuracao (id, cobranca_automatica) VALUES (TRUE, p_ligada)
  ON CONFLICT (id) DO UPDATE SET cobranca_automatica = EXCLUDED.cobranca_automatica;
  PERFORM registrar_log(CASE WHEN p_ligada THEN 'COBRANCA_AUTO_LIGADA' ELSE 'COBRANCA_AUTO_DESLIGADA' END,
                        'configuracao', NULL, NULL);
  IF p_ligada THEN
    v_qtd := gerar_mensalidades_automatico();
  END IF;
  RETURN v_qtd;
END $$;

-- ---------------------------------------------------------------------
-- Ajustes de uma cobrança
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.editar_mensalidade(p_mensalidade BIGINT, p_valor NUMERIC, p_motivo TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m        vw_mensalidade_status%ROWTYPE;
  v_nome   TEXT;
BEGIN
  IF NOT eh_admin() THEN
    RAISE EXCEPTION 'Apenas a administração altera mensalidades.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM vw_mensalidade_status WHERE id = p_mensalidade;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mensalidade não encontrada.'; END IF;
  IF p_valor IS NULL OR p_valor < 0 OR p_valor > 100000 THEN
    RAISE EXCEPTION 'Informe um valor válido.';
  END IF;
  p_valor := round(p_valor, 2);
  IF length(trim(COALESCE(p_motivo, ''))) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo da alteração (a família vai ver).';
  END IF;
  IF p_valor < m.total_pago THEN
    RAISE EXCEPTION 'O novo valor não pode ser menor que o que já foi pago (%).', reais(m.total_pago);
  END IF;
  IF m.status = 'EM_ANALISE' THEN
    RAISE EXCEPTION 'Há um comprovante em análise. Confirme ou recuse o comprovante antes de mudar o valor.';
  END IF;
  IF p_valor = m.valor_final THEN
    RAISE EXCEPTION 'O valor informado é igual ao atual.';
  END IF;

  UPDATE mensalidade SET valor_base = p_valor, desconto = 0, observacao = left(trim(p_motivo), 200)
   WHERE id = p_mensalidade;

  PERFORM registrar_log('EDITAR_MENSALIDADE', 'mensalidade', p_mensalidade::text,
          jsonb_build_object('de', m.valor_final, 'para', p_valor, 'motivo', trim(p_motivo)));
  SELECT split_part(nome_completo, ' ', 1) INTO v_nome FROM crianca WHERE id = m.crianca_id;
  PERFORM notificar_familia(m.crianca_id, 'MENSALIDADE',
          left('Mensalidade de ' || mes_ano(m.competencia) || ' (' || v_nome || ') alterada para '
               || reais(p_valor) || ': ' || trim(p_motivo), 255),
          '/familia/mensalidades');
END $$;

CREATE OR REPLACE FUNCTION public.excluir_mensalidade(p_mensalidade BIGINT, p_motivo TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m      mensalidade%ROWTYPE;
  v_nome TEXT;
BEGIN
  IF NOT eh_admin() THEN
    RAISE EXCEPTION 'Apenas a administração exclui mensalidades.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM mensalidade WHERE id = p_mensalidade FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mensalidade não encontrada.'; END IF;
  IF length(trim(COALESCE(p_motivo, ''))) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão.';
  END IF;
  IF EXISTS (SELECT 1 FROM pagamento WHERE mensalidade_id = m.id) THEN
    RAISE EXCEPTION 'Esta cobrança já tem pagamento registrado e, por segurança, não pode ser excluída. Se o valor estiver errado, use "Editar valor".';
  END IF;
  IF EXISTS (SELECT 1 FROM comprovante WHERE mensalidade_id = m.id AND status IN ('PENDENTE', 'ACEITO')) THEN
    RAISE EXCEPTION 'A família já enviou um comprovante para esta cobrança. Recuse o comprovante antes de excluir.';
  END IF;

  DELETE FROM comprovante WHERE mensalidade_id = m.id;   -- só sobram os recusados
  DELETE FROM mensalidade WHERE id = m.id;

  PERFORM registrar_log('EXCLUIR_MENSALIDADE', 'mensalidade', m.id::text,
          jsonb_build_object('crianca', m.crianca_id, 'competencia', m.competencia,
                             'valor', m.valor_final, 'motivo', trim(p_motivo)));
  SELECT split_part(nome_completo, ' ', 1) INTO v_nome FROM crianca WHERE id = m.crianca_id;
  PERFORM notificar_familia(m.crianca_id, 'MENSALIDADE',
          left('A cobrança de ' || mes_ano(m.competencia) || ' (' || v_nome || ') foi cancelada: ' || trim(p_motivo), 255),
          '/familia/mensalidades');
END $$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
  public.criar_mensalidades(DATE),
  public.gerar_mensalidades_automatico(),
  public.definir_cobranca_automatica(BOOLEAN),
  public.editar_mensalidade(BIGINT, NUMERIC, TEXT),
  public.excluir_mensalidade(BIGINT, TEXT),
  public.reais(NUMERIC),
  public.mes_ano(DATE)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.definir_cobranca_automatica(BOOLEAN),
  public.editar_mensalidade(BIGINT, NUMERIC, TEXT),
  public.excluir_mensalidade(BIGINT, TEXT)
TO authenticated;

GRANT SELECT ON vw_mensalidade_status TO authenticated;

-- ---------------------------------------------------------------------
-- Agendador: confere todo dia às 06:00 (horário de Brasília = 09:00 UTC)
-- No PostgreSQL local o pg_cron não existe e este passo é ignorado.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('cobranca-automatica', '0 9 * * *', 'SELECT public.gerar_mensalidades_automatico()');
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Agendador (pg_cron) indisponível: %', SQLERRM;
END $$;
