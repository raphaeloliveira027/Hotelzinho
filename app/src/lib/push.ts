import { useCallback, useEffect, useState } from 'react'
import { ehIPhone, jaInstalado } from './instalar'
import { supabase } from './supabase'

/**
 * Avisos no celular (notificações push do app instalado).
 * O navegador cria uma "inscrição" para este aparelho; o app guarda no banco
 * (registrar_push) e o servidor manda os avisos para ela.
 */
export type EstadoAvisos = 'carregando' | 'sem-suporte' | 'instalar-primeiro' | 'bloqueado' | 'ativo' | 'desligado'

const suporta = () =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

const comPrazo = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, falha) => setTimeout(() => falha(new Error('Demorou demais.')), ms))])

async function registro() {
  const atual = await navigator.serviceWorker.getRegistration()
  if (atual) return atual
  await navigator.serviceWorker.register('/sw.js')
  return comPrazo(navigator.serviceWorker.ready, 10000)
}

async function inscricaoAtual() {
  if (!suporta()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

const descricaoAparelho = () => {
  const ua = navigator.userAgent
  const sistema = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Outro'
  return `${sistema}${jaInstalado() ? ' (app instalado)' : ' (navegador)'}`
}

const paraBytes = (base64url: string) => {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

async function salvar(inscricao: PushSubscription) {
  const j = inscricao.toJSON()
  const { error } = await supabase!.rpc('registrar_push', {
    p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_aparelho: descricaoAparelho(),
  })
  if (error) throw new Error(error.message)
}

export async function lerEstadoAvisos(): Promise<EstadoAvisos> {
  if (ehIPhone() && !jaInstalado()) return 'instalar-primeiro'
  if (!suporta()) return ehIPhone() ? 'instalar-primeiro' : 'sem-suporte'
  if (Notification.permission === 'denied') return 'bloqueado'
  const inscricao = await inscricaoAtual()
  if (inscricao && Notification.permission === 'granted') {
    // Confirma no banco que este aparelho é de quem está logado agora
    await salvar(inscricao).catch(() => {})
    return 'ativo'
  }
  return 'desligado'
}

/** Pede permissão, cria a inscrição e guarda no banco. Devolve o novo estado. */
export async function ativarAvisos(): Promise<EstadoAvisos> {
  if (!supabase) throw new Error('O sistema ainda não foi configurado.')
  const permissao = await Notification.requestPermission()
  if (permissao === 'denied') return 'bloqueado'
  if (permissao !== 'granted') return 'desligado'
  const reg = await registro()
  let inscricao = await reg.pushManager.getSubscription()
  if (!inscricao) {
    const { data, error } = await supabase.functions.invoke('enviar-push', { method: 'GET' })
    const chave = (data as { chavePublica?: string } | null)?.chavePublica
    if (error || !chave) throw new Error('O serviço de avisos ainda não está configurado.')
    inscricao = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: paraBytes(chave) })
  }
  await salvar(inscricao)
  return 'ativo'
}

/** Desliga os avisos neste aparelho (também usado ao sair da conta). */
export async function desativarAvisos() {
  const inscricao = await inscricaoAtual()
  if (!inscricao) return
  await supabase?.rpc('remover_push', { p_endpoint: inscricao.endpoint })
  await inscricao.unsubscribe().catch(() => false)
}

/** Ao sair: o próximo a usar este celular não recebe os avisos de quem saiu. */
export const desligarAvisosAoSair = () => comPrazo(desativarAvisos(), 4000).catch(() => {})

export function useAvisos() {
  const [estado, setEstado] = useState<EstadoAvisos>('carregando')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    lerEstadoAvisos().then((e) => { if (vivo) setEstado(e) }).catch(() => { if (vivo) setEstado('desligado') })
    return () => { vivo = false }
  }, [])

  const ativar = useCallback(async () => {
    setOcupado(true); setErro(null)
    try { setEstado(await ativarAvisos()) } catch (e) { setErro((e as Error).message || 'Não foi possível ativar os avisos.') }
    setOcupado(false)
  }, [])

  const desativar = useCallback(async () => {
    setOcupado(true); setErro(null)
    try { await desativarAvisos(); setEstado('desligado') } catch { setErro('Não foi possível desativar agora.') }
    setOcupado(false)
  }, [])

  return { estado, ativar, desativar, ocupado, erro }
}
