// skin-center host half — serves the aggregated skin manifest, CSS, and
// thumbnails to the browser half. All payloads are generated assets
// (scripts/generate.mjs scans ../../skins/); nothing is read from skins/ here.
//
// Assets are read lazily per request and memoized against mtime+size, so a
// regenerated manifest/skins.css is served immediately: DSH does not need a
// restart after `node scripts/generate.mjs`, and boot no longer pays for a
// 4 MB read plus gzip before any request arrives.
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'
import { gzipSync } from 'node:zlib'

export const name = 'skin-center'
export const inject = ['webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(HERE, '..', 'assets')

const MIME = {
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp',
}

/** Memoized asset payload, keyed by file; invalidated by mtime or size change. */
const CACHE = new Map()

/**
 * Read one generated asset, reusing the compressed body until the file changes.
 * @param path - absolute file path.
 * @returns the raw and gzip body plus a short revision tag.
 */
function loadAsset(path) {
  const st = statSync(path)
  const hit = CACHE.get(path)
  if (hit !== undefined && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit
  const buf = readFileSync(path)
  const entry = {
    mtimeMs: st.mtimeMs,
    size: st.size,
    buf,
    gz: gzipSync(buf),
    rev: Math.round(st.mtimeMs).toString(36),
  }
  CACHE.set(path, entry)
  return entry
}

export function apply(ctx) {
  ctx.effect(() => {
    // gzip-negotiated JSON/CSS payloads. `Vary` is required so a shared cache
    // never replays the gzip body to a client that did not ask for it.
    const payload = (file, mime) => (req, res) => {
      let asset
      try {
        asset = loadAsset(join(ASSETS, file))
      } catch {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end(`missing generated asset: ${file} (run scripts/generate.mjs)`)
        return
      }
      const ae = String(req.headers['accept-encoding'] || '')
      const useGz = /\bgzip\b/.test(ae)
      res.writeHead(200, {
        'content-type': mime,
        'vary': 'Accept-Encoding',
        'x-skin-center-rev': asset.rev,
        ...(useGz ? { 'content-encoding': 'gzip' } : {}),
        'content-length': useGz ? asset.gz.length : asset.buf.length,
        'cache-control': 'no-store',
      })
      res.end(useGz ? asset.gz : asset.buf)
    }

    const dManifest = ctx.webServer.register({
      kind: 'exact',
      path: '/skin-center/manifest',
      handler: payload('manifest.json', MIME['.json']),
    })

    const dCss = ctx.webServer.register({
      kind: 'exact',
      path: '/skin-center/css',
      handler: payload('skins.css', MIME['.css']),
    })

    const serveDir = (sub) => (req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      const file = pathname.slice(`/skin-center/${sub}/`.length)
      if (!file || file.includes('..') || file.includes('/')) {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not found')
        return
      }
      try {
        const buf = readFileSync(join(ASSETS, sub, file))
        const ext = extname(file).toLowerCase()
        res.writeHead(200, {
          'content-type': MIME[ext] || 'application/octet-stream',
          'content-length': buf.length,
          'cache-control': 'public, max-age=86400',
        })
        res.end(buf)
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not found')
      }
    }

    const dThumbs = ctx.webServer.register({ kind: 'prefix', path: '/skin-center/thumbs', handler: serveDir('thumbs') })
    const dPreviews = ctx.webServer.register({ kind: 'prefix', path: '/skin-center/previews', handler: serveDir('previews') })

    return () => { dManifest(); dCss(); dThumbs(); dPreviews() }
  }, 'skin-center: routes')
}
