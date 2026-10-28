// Persistence contract for the skin-center pack (no dependencies — node:test only).
//
//   node tests/persistence.test.mjs
//
// (`node --test` also works outside a sandboxed shell; run the file directly when
// the DSH shell forbids the child processes the test runner spawns.)
// Two halves are covered:
//   1. the host route GET/POST /skin-center/state (durable selection,
//      validation, same-origin guard);
//   2. the browser half's boot restore (localStorage cache, host-state
//      reconciliation, migration of a pre-v0.5 local-only choice).
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const LIB = new URL('../lib/', import.meta.url)
const url = (name, query = '') => new URL(name, LIB).href + query

test('host half: /skin-center/state persists, validates, and guards origin', async () => {
  const home = mkdtempSync(join(tmpdir(), 'skin-center-home-'))
  process.env.DSH_HOME = home
  const host = await import(url('index.js'))

  const routes = new Map()
  host.apply({
    webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
    effect(fn) { fn() },
  })
  const route = routes.get('/skin-center/state')
  assert.ok(route, 'state route registered')

  const call = async (method, headers = {}, body) => {
    const request = { method, headers }
    request[Symbol.asyncIterator] = async function* () {
      if (body !== undefined) yield Buffer.from(body)
    }
    const response = { status: 0, body: '' }
    response.writeHead = (status) => { response.status = status }
    response.end = (chunk) => { if (chunk !== undefined) response.body += String(chunk) }
    await route.handler(request, response)
    return { status: response.status, json: response.body ? JSON.parse(response.body) : null }
  }
  const LOCAL = { host: '127.0.0.1:52054', origin: 'http://127.0.0.1:52054', 'content-type': 'application/json' }
  const DESKTOP = { host: 'localhost:3080', origin: 'dsh-app://app', 'content-type': 'application/json' }

  let res = await call('GET', { host: LOCAL.host })
  assert.deepEqual(res.json, { id: null, bodyAttr: null, stored: false }, 'nothing stored yet')

  res = await call('POST', LOCAL, JSON.stringify({ id: 'catppuccin', bodyAttr: 'data-dsh-catppuccin' }))
  assert.equal(res.status, 200)
  assert.equal(res.json.id, 'catppuccin')
  const file = join(home, 'skin-center', 'state.json')
  assert.ok(existsSync(file))
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).id, 'catppuccin')

  res = await call('GET', { host: LOCAL.host })
  assert.equal(res.json.id, 'catppuccin', 'survives a process that only reads the file')

  res = await call('POST', DESKTOP, JSON.stringify({ id: 'dracula', bodyAttr: 'data-dsh-dracula' }))
  assert.equal(res.status, 200, 'desktop dsh-app:// page may write')
  assert.equal(res.json.id, 'dracula')

  res = await call('POST', { ...LOCAL, origin: 'http://evil.example' }, JSON.stringify({ id: 'nord' }))
  assert.equal(res.status, 403, 'foreign origin rejected')

  for (const bad of [JSON.stringify({ id: '../etc/passwd' }), JSON.stringify({ id: 42 }), '{not json']) {
    res = await call('POST', LOCAL, bad)
    assert.equal(res.status, 400, `rejects ${bad}`)
  }

  res = await call('POST', LOCAL, JSON.stringify({ id: 'nord' }))
  assert.equal(res.json.bodyAttr, 'data-dsh-nord', 'bodyAttr defaults to data-dsh-<id>')

  res = await call('POST', LOCAL, JSON.stringify({ id: null }))
  assert.deepEqual([res.json.id, res.json.stored], [null, true], 'clearing is remembered, not "never chosen"')

  res = await call('PUT', LOCAL)
  assert.equal(res.status, 405)
})

test('client half: boot restore, host reconciliation, and migration', async () => {
  const attrs = []
  const body = {
    get attributes() { return attrs },
    setAttribute(name, value) {
      const hit = attrs.find((a) => a.name === name)
      if (hit) hit.value = value
      else attrs.push({ name, value })
    },
    removeAttribute(name) {
      const i = attrs.findIndex((a) => a.name === name)
      if (i >= 0) attrs.splice(i, 1)
    },
  }
  const head = { children: [], appendChild(el) { this.children.push(el); return el } }
  globalThis.document = {
    body,
    head,
    getElementById: (id) => head.children.find((el) => el.id === id) ?? null,
    createElement: (tag) => ({ tag, id: '', rel: '', href: '' }),
    addEventListener() {},
    removeEventListener() {},
  }
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: (k) => { store.delete(k) },
  }
  let hostState = { stored: false, id: null, bodyAttr: null }
  const posts = []
  globalThis.fetch = (href, init = {}) => {
    if (href !== '/skin-center/state') return Promise.resolve({ ok: false, json: async () => null })
    if ((init.method || 'GET') === 'POST') {
      const payload = JSON.parse(init.body)
      posts.push(payload)
      hostState = payload.id
        ? { stored: true, id: payload.id, bodyAttr: payload.bodyAttr }
        : { stored: true, id: null, bodyAttr: null }
      return Promise.resolve({ ok: true, json: async () => hostState })
    }
    return Promise.resolve({ ok: true, json: async () => hostState })
  }

  let captured
  globalThis.window = { __ModuleLoader__: { load: (mod) => { captured = mod } } }
  const React = {
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value ?? null }),
    createElement: () => null,
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 10))
  const boot = async (name) => {
    captured = undefined
    await import(url('client.js', '?case=' + name))
    assert.ok(captured, 'client bundle called __ModuleLoader__.load')
    captured.factory(() => React)
  }
  const reset = () => {
    attrs.length = 0
    store.clear()
    posts.length = 0
    head.children.length = 0
  }

  // A local-only choice is worn before the host answers, then migrated up once.
  reset()
  store.set('skinCenter:state', JSON.stringify({ id: 'catppuccin', bodyAttr: 'data-dsh-catppuccin' }))
  hostState = { stored: false, id: null, bodyAttr: null }
  await boot('migrate')
  assert.ok(attrs.some((a) => a.name === 'data-dsh-catppuccin'), 'cached skin applied synchronously')
  assert.equal(head.children[0].href, '/skin-center/css', 'stylesheet injected')
  await tick()
  assert.deepEqual(posts[0], { id: 'catppuccin', bodyAttr: 'data-dsh-catppuccin' }, 'local choice migrated')

  // The host state (written by another browser or an earlier launch) wins.
  reset()
  store.set('skinCenter:state', JSON.stringify({ id: 'catppuccin', bodyAttr: 'data-dsh-catppuccin' }))
  hostState = { stored: true, id: 'dracula', bodyAttr: 'data-dsh-dracula' }
  await boot('server-wins')
  assert.ok(attrs.some((a) => a.name === 'data-dsh-catppuccin'))
  await tick()
  assert.deepEqual(attrs.map((a) => a.name), ['data-dsh-dracula'], 'server skin replaces the stale cache')
  assert.equal(posts.length, 0, 'no write-back when the host already knows')

  // An explicit clear on the host beats a stale local cache.
  reset()
  store.set('skinCenter:state', JSON.stringify({ id: 'nord', bodyAttr: 'data-dsh-nord' }))
  hostState = { stored: true, id: null, bodyAttr: null }
  await boot('server-cleared')
  await tick()
  assert.deepEqual(attrs, [], 'cleared host state removes the skin')
  assert.equal(store.has('skinCenter:state'), false, 'local cache cleared too')

  // Fresh install: stock theme, no stylesheet fetch.
  reset()
  hostState = { stored: false, id: null, bodyAttr: null }
  await boot('fresh')
  await tick()
  assert.deepEqual(attrs, [])
  assert.equal(head.children.length, 0, 'no stylesheet for the stock theme')
  assert.equal(posts.length, 0)
})
