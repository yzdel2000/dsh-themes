// skin-center host half — serves the aggregated skin manifest, CSS, and
// thumbnails to the browser half. All payloads are generated assets
// (scripts/generate.mjs scans ../../skins/); nothing is read from skins/ here.
//
// Assets are read lazily per request and memoized against mtime+size, so a
// regenerated manifest/skins.css is served immediately: DSH does not need a
// restart after `node scripts/generate.mjs`, and boot no longer pays for a
// 4 MB read plus gzip before any request arrives.
//
// The one writable thing here is the "last worn skin" record: `/skin-center/state`
// (GET/POST) keeps it in ~/.dsh/skin-center/state.json so the selection survives
// a relaunch even when the loopback port — and with it the browser origin — changes.
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'
import { homedir } from 'node:os'
import { gzipSync } from 'node:zlib'

export const name = 'skin-center'
export const inject = ['webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(HERE, '..', 'assets')
const STATE_FILE = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'skin-center', 'state.json')

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const ATTR_RE = /^data-dsh-[a-z0-9-]{1,64}$/
const BODY_LIMIT = 4 * 1024

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

/**
 * Read the durable "last worn skin" record.
 * @returns the selection plus `stored`: false until the file exists, so the
 *   browser can tell "never chosen" from "explicitly cleared".
 */
function readSelection() {
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    const id = raw && typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null
    if (id === null) return { id: null, bodyAttr: null, stored: true }
    // A hand-edited record with only `id` still restores: every skin's body
    // attribute follows `data-dsh-<id>` unless the record names another one.
    const bodyAttr = raw && typeof raw.bodyAttr === 'string' && ATTR_RE.test(raw.bodyAttr)
      ? raw.bodyAttr
      : `data-dsh-${id}`
    return { id, bodyAttr, stored: true }
  } catch {
    return { id: null, bodyAttr: null, stored: false }
  }
}

function writeSelection(selection) {
  mkdirSync(dirname(STATE_FILE), { recursive: true })
  writeFileSync(STATE_FILE, `${JSON.stringify({ ...selection, updatedAt: new Date().toISOString() }, null, 2)}\n`)
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

function loopbackAuthority(authority) {
  try {
    const url = new URL(`http://${authority}`)
    return LOOPBACK.has(url.hostname.toLowerCase()) ? `loopback:${url.port || '80'}` : null
  } catch { return null }
}

/**
 * Only this host's own pages may write (same-origin guard, as the plugin hub
 * does). The desktop shell serves the page from `dsh-app://app`, so that
 * protocol is allowed explicitly.
 */
function sameOrigin(req) {
  const hostKey = req.headers.host === undefined ? null : loopbackAuthority(req.headers.host)
  if (hostKey === null) return false
  const origin = req.headers.origin
  if (origin === undefined || origin === '') return true
  try {
    const url = new URL(origin)
    if (url.protocol === 'dsh-app:') return true
    return loopbackAuthority(url.host) === hostKey
  } catch { return false }
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > BODY_LIMIT) throw new Error('request body too large')
    chunks.push(buf)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
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

    // GET returns the last worn skin; POST (JSON `{ id, bodyAttr }`, `id: null`
    // to clear) stores it. One handler for both methods: webServer.register keys
    // routes by (kind, path).
    const dState = ctx.webServer.register({
      kind: 'exact',
      path: '/skin-center/state',
      handler: async (req, res) => {
        if (req.method === 'GET') {
          sendJson(res, 200, readSelection())
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'GET, POST' })
          res.end()
          return
        }
        if (!sameOrigin(req)) {
          sendJson(res, 403, { error: 'untrusted origin' })
          return
        }
        let body
        try {
          body = await readJsonBody(req)
        } catch {
          sendJson(res, 400, { error: 'malformed body' })
          return
        }
        const id = body !== null && typeof body === 'object' ? body.id : undefined
        let selection
        if (id === null || id === undefined) {
          selection = { id: null, bodyAttr: null }
        } else if (typeof id === 'string' && ID_RE.test(id)) {
          const bodyAttr = typeof body.bodyAttr === 'string' && ATTR_RE.test(body.bodyAttr)
            ? body.bodyAttr
            : `data-dsh-${id}`
          selection = { id, bodyAttr }
        } else {
          sendJson(res, 400, { error: 'invalid skin id' })
          return
        }
        try {
          writeSelection(selection)
        } catch {
          sendJson(res, 500, { error: 'cannot persist skin state' })
          return
        }
        sendJson(res, 200, readSelection())
      },
    })

    return () => { dManifest(); dCss(); dThumbs(); dPreviews(); dState() }
  }, 'skin-center: routes')
}
