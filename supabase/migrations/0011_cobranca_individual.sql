-- =====================================================================
-- 0011 — Cobrança individual
-- A administração cria a mensalidade de UMA criança, para o mês que escolher,
-- com o valor do plano ou outro valor (com motivo). A família é avisada.
-- Continua valendo: uma mensalidade por criança por mês (para mudar uma já
-- existente, use editar_mensalidade).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.criar_cobranca_individual(
  p_crianca BIGINT, p_competencia DATE, p_valor NUMERIC DEFAULT NULL, p_motivo TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_comp   DATE := date_trunc('month', p_competencia)::date;
  c        crianca%ROWTYPE;
  v_plano  NUMERIC;
  v_valor  NUMERIC;
  v_motivo TEXT := NULLIF(trim(COALESCE(p_motivo, '')), '');
  v_id     BIGINT;
  v_nome   TEXT;
BEGIN
  IF NOT eh_admin() THEN
    RAISE EXCEPTION 'Apenas a administração cria cobranças.' USING ERRCODE = '42501';
  END IF;
  IF p_competencia IS NULL THEN RAISE EXCEPTION 'Escolha o mês da cobrança.'; END IF;
  SELECT * INTO c FROM crianca WHERE id = p_crianca;
  IF NOT FOUND THEN RAISE EXCEPTION 'Criança não encontrada.'; END IF;
  IF c.status = 'INATIVA' THEN RAISE EXCEPTION 'Esta criança está inativa.'; END IF;
  SELECT valor INTO v_plano FROM plano WHERE id = c.plano_id;

  v_valor := round(COALESCE(p_valor, v_plano), 2);
  IF v_valor IS NULL OR v_valor < 0 OR v_valor > 100000 THEN
    RAISE EXCEPTION 'Informe um valor válido.';
  END IF;
  IF v_valor IS DISTINCT FROM v_plano AND (v_motivo IS NULL OR length(v_motivo) < 3) THEN
    RAISE EXCEPTION 'O valor é diferente do plano: informe o motivo (a família vai ver).';
  END IF;
  IF EXISTS (SELECT 1 FROM mensalidade WHERE crianca_id = c.id AND competencia = v_comp) THEN
    RAISE EXCEPTION 'Já existe a cobrança de % para esta criança. Para mudar o valor, abra a cobrança e use "Editar valor".', mes_ano(v_comp);
  END IF;

  INSERT INTO mensalidade (crianca_id, competencia, valor_base, data_vencimento, observacao)
  VALUES (c.id, v_comp, v_valor, (v_comp + INTERVAL '1 month' - INTERVAL '1 day')::date,
          CASE WHEN v_valor IS DISTINCT FROM v_plano THEN left(v_motivo, 200) END)
  RETURNING id INTO v_id;

  PERFORM registrar_log('COBRANCA_INDIVIDUAL', 'mensalidade', v_id::text,
          jsonb_build_object('crianca', c.id, 'competencia', v_comp, 'valor', v_valor, 'motivo', v_motivo));
  v_nome := split_part(c.nome_completo, ' ', 1);
  PERFORM notificar_familia(c.id, 'MENSALIDADE',
          left('Nova cobrança: mensalidade de ' || mes_ano(v_comp) || ' (' || v_nome || '), ' || reais(v_valor)
               || ', vence em ' || to_char((v_comp + INTERVAL '1 month' - INTERVAL '1 day')::date, 'DD/MM') || '.', 255),
          '/familia/mensalidades');
  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.criar_cobranca_individual(BIGINT, DATE, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.criar_cobranca_individual(BIGINT, DATE, NUMERIC, TEXT) TO authenticated;
