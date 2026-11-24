-- =====================================================================
-- Migration 0003: controle de acesso no próprio banco (Row Level Security)
--
-- Regra central: o ADMIN vê e altera tudo; o RESPONSÁVEL só LÊ linhas
-- ligadas às crianças vinculadas a ele (minhas_criancas()).
-- Mesmo que a tela tenha um erro, o banco não entrega dados de outra família.
-- =====================================================================

-- Permissões básicas: visitante sem login (anon) não acessa nada.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Funções internas não ficam expostas como RPC; só as de uso do app.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.eh_admin(), public.meu_responsavel_id(), public.minhas_criancas(),
  public.gerar_mensalidades(DATE), public.confirmar_comprovante(BIGINT, DATE),
  public.recusar_comprovante(BIGINT, TEXT),
  public.atualizar_meu_contato(TEXT, TEXT, TEXT, TEXT), public.aceitar_termo()
TO authenticated;

-- Liga o RLS em todas as tabelas
ALTER TABLE usuario              ENABLE ROW LEVEL SECURITY;
ALTER TABLE responsavel          ENABLE ROW LEVEL SECURITY;
ALTER TABLE plano                ENABLE ROW LEVEL SECURITY;
ALTER TABLE feriado              ENABLE ROW LEVEL SECURITY;
ALTER TABLE crianca              ENABLE ROW LEVEL SECURITY;
ALTER TABLE crianca_responsavel  ENABLE ROW LEVEL SECURITY;
ALTER TABLE medida_crescimento   ENABLE ROW LEVEL SECURITY;
ALTER TABLE presenca             ENABLE ROW LEVEL SECURITY;
ALTER TABLE registro_rotina      ENABLE ROW LEVEL SECURITY;
ALTER TABLE alteracao_informada  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensalidade          ENABLE ROW LEVEL SECURITY;
ALTER TABLE comprovante          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagamento            ENABLE ROW LEVEL SECURITY;
ALTER TABLE comunicado           ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensagem             ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificacao          ENABLE ROW LEVEL SECURITY;
ALTER TABLE log_auditoria        ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracao         ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- ADMIN: acesso total às tabelas de cadastro, rotina, financeiro e comunicação
-- ---------------------------------------------------------------------
CREATE POLICY admin_total ON usuario             FOR ALL TO authenticated USING (eh_admin()) WITH CHECK (eh_admin());
CREATE POLICY admin_total ON responsavel         FOR ALL TO authenticated USING (eh_admin()) WITH CHECK (eh_admin());
CREATE POLICY admin_total ON plano               FOR ALL TO authenticated USING (eh_admin()) WITH CHECK (eh_admin());
CREATE POLICY admin_total ON feriado             FOR ALL TO authenticated USING (eh_admin()) WITH CHECK (eh_admin());
CREATE POLICY admin_total ON crianca             FOR ALL TO authenticated USING (eh_admin()) WITH CHECK (eh_admin());
CREATE POLICY admin_total ON crianca_responsavel FOR ALL TO authenticated USING (eh_admin()) WITH CHECK (eh_admin());
CREATE POLICY admin_total ON medida_crescimento  FOR ALL TO authenticated USING (eh_admin()) WITH CHECK (eh_admin());
CREATE POLICY admin_total ON presenca            FOR ALL TO authenticated USING (eh_admin()) WITH CHECK (eh_admin());
CREATE POLICY admin_total ON registro_rotina     FOR ALL TO authenticated USING (eh_admin()) WITH CHECK (eh_admin());
CREATE POLICY admin_total ON alteracao_informada FOR ALL TO authenticated USING (eh_admin()) WITH CHECK (eh_admin());
CREATE POLICY admin_total ON mensalidade         FOR ALL TO authenticated USING (eh_admin()) WITH CHECK (eh_admin());
CREATE POLICY admin_total ON comprovante         FOR ALL TO authenticated USING (eh_admin()) WITH CHECK (eh_admin());
CREATE POLICY admin_total ON comunicado          FOR ALL TO authenticated USING (eh_admin()) WITH CHECK (eh_admin());
CREATE POLICY admin_total ON mensagem            FOR ALL TO authenticated USING (eh_admin()) WITH CHECK (eh_admin());
CREATE POLICY admin_total ON configuracao        FOR ALL TO authenticated USING (eh_admin()) WITH CHECK (eh_admin());
-- Pagamento: admin lê; criação só pela função confirmar_comprovante ou registro manual
CREATE POLICY admin_total ON pagamento           FOR ALL TO authenticated USING (eh_admin()) WITH CHECK (eh_admin());
-- Log: admin só lê (ninguém altera pelo app)
CREATE POLICY admin_le ON log_auditoria          FOR SELECT TO authenticated USING (eh_admin());

-- ---------------------------------------------------------------------
-- RESPONSÁVEL: leitura restrita às próprias crianças
-- ---------------------------------------------------------------------
CREATE POLICY resp_le_proprio_usuario ON usuario
  FOR SELECT TO authenticated USING (id = auth.uid());

CREATE POLICY resp_le_proprio_cadastro ON responsavel
  FOR SELECT TO authenticated USING (usuario_id = auth.uid());

CREATE POLICY todos_leem ON plano       FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY todos_leem ON feriado     FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY todos_leem ON configuracao FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY resp_le ON crianca
  FOR SELECT TO authenticated USING (id IN (SELECT minhas_criancas()));

CREATE POLICY resp_le ON crianca_responsavel
  FOR SELECT TO authenticated USING (crianca_id IN (SELECT minhas_criancas()));

CREATE POLICY resp_le ON medida_crescimento
  FOR SELECT TO authenticated USING (crianca_id IN (SELECT minhas_criancas()));

CREATE POLICY resp_le ON presenca
  FOR SELECT TO authenticated USING (crianca_id IN (SELECT minhas_criancas()));

-- Rotina: só o que a administração marcou como visível
CREATE POLICY resp_le ON registro_rotina
  FOR SELECT TO authenticated
  USING (visivel_pais AND crianca_id IN (SELECT minhas_criancas()));

CREATE POLICY resp_le ON mensalidade
  FOR SELECT TO authenticated USING (crianca_id IN (SELECT minhas_criancas()));

CREATE POLICY resp_le ON pagamento
  FOR SELECT TO authenticated
  USING (mensalidade_id IN (SELECT id FROM mensalidade WHERE crianca_id IN (SELECT minhas_criancas())));

CREATE POLICY resp_le ON comprovante
  FOR SELECT TO authenticated
  USING (mensalidade_id IN (SELECT id FROM mensalidade WHERE crianca_id IN (SELECT minhas_criancas())));

-- Comunicado geral (crianca_id nulo) ou da própria criança
CREATE POLICY resp_le ON comunicado
  FOR SELECT TO authenticated
  USING (crianca_id IS NULL OR crianca_id IN (SELECT minhas_criancas()));

CREATE POLICY resp_le ON mensagem
  FOR SELECT TO authenticated USING (crianca_id IN (SELECT minhas_criancas()));

CREATE POLICY resp_le ON alteracao_informada
  FOR SELECT TO authenticated
  USING (responsavel_id = meu_responsavel_id());

CREATE POLICY dono_le ON notificacao
  FOR SELECT TO authenticated USING (usuario_id = auth.uid());

-- ---------------------------------------------------------------------
-- RESPONSÁVEL: o que ele pode CRIAR ou ALTERAR
-- ---------------------------------------------------------------------
-- Enviar comprovante de mensalidade da própria criança, sempre como PENDENTE
CREATE POLICY resp_envia ON comprovante
  FOR INSERT TO authenticated
  WITH CHECK (
    responsavel_id = meu_responsavel_id()
    AND status = 'PENDENTE' AND analisado_por IS NULL AND analisado_em IS NULL
    AND mensalidade_id IN (SELECT id FROM mensalidade
                           WHERE crianca_id IN (SELECT minhas_criancas()) AND NOT cancelada)
  );

-- Mandar mensagem sobre a própria criança, em nome próprio
CREATE POLICY resp_envia ON mensagem
  FOR INSERT TO authenticated
  WITH CHECK (remetente_id = auth.uid() AND lida_em IS NULL
              AND crianca_id IN (SELECT minhas_criancas()));

-- Informar alteração importante (fica PENDENTE até a administração revisar)
CREATE POLICY resp_envia ON alteracao_informada
  FOR INSERT TO authenticated
  WITH CHECK (responsavel_id = meu_responsavel_id() AND status = 'PENDENTE'
              AND revisado_por IS NULL AND crianca_id IN (SELECT minhas_criancas()));

-- Marcar as próprias notificações como lidas
CREATE POLICY dono_marca_lida ON notificacao
  FOR UPDATE TO authenticated
  USING (usuario_id = auth.uid()) WITH CHECK (usuario_id = auth.uid());

-- Na notificação, só a coluna "lida" pode ser alterada pelo app
REVOKE UPDATE ON notificacao FROM authenticated;
GRANT UPDATE (lida) ON notificacao TO authenticated;
-- Log e notificações são criados apenas pelo próprio banco (gatilhos/funções)
REVOKE INSERT, UPDATE, DELETE ON log_auditoria FROM authenticated;
REVOKE INSERT, DELETE ON notificacao FROM authenticated;

-- Dados de contato do responsável: só pela função atualizar_meu_contato()
