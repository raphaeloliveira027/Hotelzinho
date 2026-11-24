-- =====================================================================
-- Migration 0005: financeiro
--  1) Bucket privado "comprovantes" no Storage do Supabase, com regras:
--     - o responsável só envia arquivos para a pasta com o número dele;
--     - o responsável só lê os próprios arquivos; a administradora lê todos.
--  2) Pagamento registrado à mão (dinheiro, Pix fora do app): avisa a
--     família e fica no log, como acontece na confirmação de comprovante.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Storage
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('comprovantes', 'comprovantes', FALSE, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Caminho do arquivo: <id do responsável>/<id da mensalidade>-<data>.<ext>
CREATE POLICY comprovante_resp_envia ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'comprovantes'
              AND (storage.foldername(name))[1] = public.meu_responsavel_id()::text);

CREATE POLICY comprovante_le ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'comprovantes'
         AND (public.eh_admin() OR (storage.foldername(name))[1] = public.meu_responsavel_id()::text));

-- ---------------------------------------------------------------------
-- 2) Pagamento manual
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ao_registrar_pagamento_manual() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_crianca BIGINT;
BEGIN
  IF NEW.comprovante_id IS NULL THEN   -- confirmação de comprovante já registra pela função
    SELECT crianca_id INTO v_crianca FROM mensalidade WHERE id = NEW.mensalidade_id;
    PERFORM registrar_log('PAGAMENTO_MANUAL', 'pagamento', NEW.id::text,
            jsonb_build_object('mensalidade', NEW.mensalidade_id, 'valor', NEW.valor_pago, 'forma', NEW.forma));
    PERFORM notificar_familia(v_crianca, 'COMPROVANTE',
            'Pagamento registrado pela administração. Obrigado!', '/familia/mensalidades');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_pagamento_manual
AFTER INSERT ON pagamento
FOR EACH ROW EXECUTE FUNCTION public.ao_registrar_pagamento_manual();

REVOKE EXECUTE ON FUNCTION public.ao_registrar_pagamento_manual() FROM PUBLIC, anon, authenticated;
