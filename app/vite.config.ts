import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { FRASE_HOTELZINHO, NOME_CURTO, NOME_HOTELZINHO } from './src/lib/marca.ts'

/** Manifesto do app instalável (PWA): nome, ícones e cores que o celular usa ao instalar. */
const manifesto = {
  name: NOME_HOTELZINHO,
  short_name: NOME_CURTO,
  description: FRASE_HOTELZINHO,
  lang: 'pt-BR',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#FFF8EC',
  theme_color: '#1D6FB8',
  icons: [
    { src: '/icones/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icones/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icones/icone-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}

function appInstalavel(): Plugin {
  const json = JSON.stringify(manifesto, null, 2)
  return {
    name: 'hotelzinho-app-instalavel',
    transformIndexHtml: (html) => html.replaceAll('%NOME_HOTELZINHO%', NOME_HOTELZINHO),
    configureServer(server) {
      server.middlewares.use('/manifest.webmanifest', (_req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json')
        res.end(json)
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: json })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), appInstalavel()],
})
