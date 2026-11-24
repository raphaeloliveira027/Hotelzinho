/*
 * Service worker do app instalável.
 * - Telas (navegação): busca na internet primeiro; sem internet, abre a última versão guardada.
 * - Arquivos do app (/assets, ícones): guardados no celular para abrir mais rápido.
 * - Dados do Supabase (crianças, mensalidades, mensagens) NUNCA são guardados aqui:
 *   sempre vêm do servidor, com as regras de acesso de cada pessoa.
 */
const VERSAO = 'hotelzinho-v4'
const ESSENCIAIS = ['/', '/manifest.webmanifest', '/icones/icone.svg', '/icones/icone-192.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ESSENCIAIS)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return // Supabase e outros sites: direto na rede

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((resp) => {
          const copia = resp.clone()
          caches.open(VERSAO).then((c) => c.put('/', copia))
          return resp
        })
        .catch(() => caches.match('/').then((r) => r ?? new Response('Sem internet no momento.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))),
    )
    return
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icones/')) {
    e.respondWith(
      caches.match(req).then((guardado) => guardado ?? fetch(req).then((resp) => {
        if (resp.ok) { const copia = resp.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)) }
        return resp
      })),
    )
  }
})

// ---------------------------------------------------------------------
// Avisos no celular (push): o servidor manda {titulo, texto, link, tag}
// ---------------------------------------------------------------------
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { texto: e.data ? e.data.text() : '' } }
  const link = typeof d.link === 'string' && d.link.startsWith('/') ? d.link : '/'
  e.waitUntil(self.registration.showNotification(d.titulo ? `Hotelzinho · ${d.titulo}` : 'Hotelzinho', {
    body: d.texto || 'Você tem um aviso novo.',
    icon: '/icones/icone-192.png',
    badge: '/icones/badge-96.png',
    tag: d.tag || undefined,
    data: { link },
  }))
})

// Tocar no aviso: abre o app na tela certa (ou traz o app aberto para frente)
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const link = (e.notification.data && e.notification.data.link) || '/'
  e.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const aberta = janelas.find((j) => new URL(j.url).origin === self.location.origin)
    if (aberta) {
      await aberta.focus()
      aberta.postMessage({ tipo: 'abrir-aviso', link })
      return
    }
    await self.clients.openWindow(link)
  })())
})
