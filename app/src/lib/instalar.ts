import { useEffect, useState } from 'react'

/** Evento do Chrome/Android que permite abrir a janela "Instalar app". */
type PedidoInstalacao = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let pedido: PedidoInstalacao | null = null
const ouvintes = new Set<() => void>()
const avisar = () => ouvintes.forEach((f) => f())

export const jaInstalado = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export const ehIPhone = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/** Chamar uma vez ao abrir o app: registra o service worker e guarda o pedido de instalação. */
export function prepararAppInstalavel() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pedido = e as PedidoInstalacao; avisar() })
  window.addEventListener('appinstalled', () => { pedido = null; avisar() })
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) })
  }
}

export type ModoInstalacao = 'botao' | 'iphone' | 'nenhum'

/** Diz o que mostrar: botão de instalar (Android/Chrome), instruções (iPhone) ou nada (já instalado). */
export function useInstalacao() {
  const calcular = (): ModoInstalacao => (jaInstalado() ? 'nenhum' : pedido ? 'botao' : ehIPhone() ? 'iphone' : 'nenhum')
  const [modo, setModo] = useState<ModoInstalacao>(calcular)
  useEffect(() => {
    const f = () => setModo(calcular())
    ouvintes.add(f)
    return () => { ouvintes.delete(f) }
  }, [])
  const instalar = async () => {
    if (!pedido) return
    await pedido.prompt()
    await pedido.userChoice
    pedido = null
    avisar()
  }
  return { modo, instalar }
}
