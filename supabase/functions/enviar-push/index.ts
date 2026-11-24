// Função do Supabase "enviar-push": manda os avisos para o celular.
//
//  GET  → devolve a chave pública (o app precisa dela para ativar os avisos).
//  POST {"notificacao": 123} → chamada pelo próprio banco quando nasce uma notificação.
//        Pega o texto no banco (uma vez só), envia para os aparelhos da pessoa
//        e apaga os aparelhos que não existem mais.
//
// Segredos (Edge Functions › Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// Quem chama não escolhe o texto nem o destino: tudo vem do banco, então a função
// pode ficar sem exigir login ("Verify JWT" desligado), como o banco precisa.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

// Tira espaços e quebras de linha que entram sem querer ao colar os segredos no painel
const limpar = (v?: string) => (v ?? '').replace(/\s+/g, '')
const VAPID_PUBLIC = limpar(Deno.env.get('VAPID_PUBLIC_KEY'))
const VAPID_PRIVATE = limpar(Deno.env.get('VAPID_PRIVATE_KEY'))
const assunto = limpar(Deno.env.get('VAPID_SUBJECT'))
// Aceita o e-mail com ou sem o "mailto:" na frente
const VAPID_SUBJECT = assunto && !/^(mailto:|https:)/i.test(assunto) && assunto.includes('@') ? `mailto:${assunto}` : assunto
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const CHAVE_SERVIDOR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

type Inscricao = { endpoint: string; p256dh: string; auth: string }
type Aviso = { titulo: string; texto: string; link: string; tag: string; inscricoes: Inscricao[] }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !VAPID_SUBJECT) {
    return resposta({ erro: 'Faltam os segredos VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT.' }, 500)
  }
  if (req.method === 'GET') return resposta({ chavePublica: VAPID_PUBLIC })
  if (req.method !== 'POST') return resposta({ erro: 'Método não aceito.' }, 405)

  let id = 0
  try { id = Number((await req.json())?.notificacao) } catch { /* corpo inválido */ }
  if (!Number.isSafeInteger(id) || id <= 0) return resposta({ erro: 'Notificação inválida.' }, 400)
  if (!SUPABASE_URL || !CHAVE_SERVIDOR) return resposta({ erro: 'Chave do servidor indisponível.' }, 500)

  const db = createClient(SUPABASE_URL, CHAVE_SERVIDOR, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await db.rpc('reivindicar_push', { p_notificacao: id })
  if (error) return resposta({ erro: error.message }, 500)
  const aviso = data as Aviso | null
  if (!aviso) return resposta({ enviados: 0, motivo: 'Já enviada, antiga ou inexistente.' })

  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
  } catch (e) {
    // Devolve a notificação para a fila, para não perder o aviso depois que os segredos forem corrigidos
    await db.from('notificacao').update({ push_enviado_em: null }).eq('id', id)
    return resposta({ erro: `Segredos VAPID inválidos: ${(e as Error).message}` }, 500)
  }
  const conteudo = JSON.stringify({ titulo: aviso.titulo, texto: aviso.texto, link: aviso.link, tag: aviso.tag })
  let enviados = 0
  let removidos = 0
  await Promise.all(aviso.inscricoes.map(async (i) => {
    try {
      await webpush.sendNotification(
        { endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } },
        conteudo,
        { TTL: 60 * 60 * 24, urgency: 'high' },
      )
      enviados++
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        await db.rpc('remover_push_vencida', { p_endpoint: i.endpoint })
        removidos++
      } else {
        console.error('Aviso não enviado', status, (e as { body?: string }).body ?? String(e))
      }
    }
  }))
  return resposta({ enviados, removidos })
})
