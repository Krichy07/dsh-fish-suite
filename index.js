import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

export const name = 'dsh-fish-suite'
export const inject = ['webServer', 'agents', 'timer', 'workingDirectory', 'tools', 'sessions', 'sessionTitle']

const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url))
const VENDOR = path.join(PACKAGE_ROOT, 'vendor')
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
let DATA = path.join(DSH_HOME, 'fish-suite')
try {
  const local = JSON.parse(fs.readFileSync(path.join(DSH_HOME, 'fish-suite-local.json'), 'utf8'))
  if (typeof local.dataDir === 'string' && local.dataDir) DATA = local.dataDir
} catch {
  /* portable default */
}
const STATE_FILE = path.join(DATA, 'fish-suite.json')
const WORKSPACE_REGISTRY = path.join(DSH_HOME, 'storages', 'workspace.json')
const SESSION_CACHE_DIR = path.join(DSH_HOME, 'storages', 'session_projcache', 'sessions')
const MOOD_DIR = path.join(DATA, 'feiyu-mood')
const MOOD_CONFIG = path.join(MOOD_DIR, 'config.json')
const MOOD_STATE = path.join(MOOD_DIR, 'state.json')
const OFF_TARGET = '__fish_suite_off__'
const FISH_TOGGLE = '/dsh-fish-memory/toggle'
const MOOD_CONFIG_ROUTE = '/dsh-feiyu-mood/config'

const REMEMBER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: {
      type: 'string',
      description: '要记住的事，一句话说清。',
    },
    importance: {
      type: 'number',
      description: '0 = 随口提过；0.5 = 比较重要；1 = 非常重要。不确定写 0.5。',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: '几个关键词，方便以后被想起来。',
    },
    取代: {
      type: 'string',
      description: '可选。这次记的是在更新哪条旧记忆，填旧条大意或原文片段。',
    },
    事实键: {
      type: 'string',
      description: '可选。这件事的对象.方面，例如 她.身高；同一键只保留最新一条。',
    },
  },
  required: ['text'],
}

// Dependencies read DSH_HOME at module load. This suite never mutates that
// process-global value: compatibility junctions on the C home point the two
// data directories at 鱼的一切\data instead.
const fishMemory = await import(pathToFileURL(path.join(VENDOR, 'dsh-fish-memory-main', 'lib', 'index.js')).href)
const yuMood = await import(pathToFileURL(path.join(VENDOR, 'dsh-yu-mood-main', 'lib', 'index.js')).href)

function readState() {
  try {
    const value = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    return {
      workspaces: Array.isArray(value.workspaces)
        ? value.workspaces.filter((item) => typeof item === 'string')
        : [],
      focusSession:
        typeof value.focusSession === 'string' ? value.focusSession : '',
    }
  } catch {
    return { workspaces: [], focusSession: '' }
  }
}

function readWorkspaces() {
  try {
    const value = JSON.parse(fs.readFileSync(WORKSPACE_REGISTRY, 'utf8'))
    const table = value?.tables?.workspaces
    if (!table || typeof table !== 'object') return []
    return Object.entries(table)
      .map(([workspaceId, row]) => ({
        workspaceId,
        path: String(row?.path || ''),
        title: String(row?.title || row?.path || ''),
        sessionIds: Array.isArray(row?.sessionIds)
          ? row.sessionIds.filter((id) => typeof id === 'string')
          : [],
      }))
      .filter((row) => row.path)
  } catch {
    return []
  }
}

function saveState(workspaces, focusSession) {
  try {
    fs.mkdirSync(DATA, { recursive: true })
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ workspaces, focusSession: String(focusSession || '') }, null, 2),
      'utf8',
    )
  } catch {
    /* best effort */
  }
}

function normalizePath(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    return path.resolve(value.trim()).replace(/[\\/]+$/, '').toLowerCase()
  } catch {
    return ''
  }
}

function sidOf(agent) {
  return String(agent?.session?.id ?? agent?.session?.header?.id ?? '')
}

function readMood() {
  try {
    const state = JSON.parse(fs.readFileSync(MOOD_STATE, 'utf8'))
    return {
      value: Number(state.mood),
      dims: state.dims && typeof state.dims === 'object' ? state.dims : {},
      lastReason: typeof state.lastReason === 'string' ? state.lastReason : '',
      at: state.updatedAt ?? state.at ?? null,
    }
  } catch {
    return null
  }
}

async function readJson(req) {
  const parts = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 16384) throw new Error('request too large')
    parts.push(chunk)
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

export function apply(ctx) {
  const initial = readState()
  const whitelist = new Set(initial.workspaces.map(normalizePath).filter(Boolean))
  const fishEnabled = new Map()
  let lastTarget = ''
  let tabRegistered = null
  let syncing = false
  let resetDone = false
  const managed = new Set()
  let focusSession = initial.focusSession || ''

  // The dependencies read their own config at apply time. Point mood away from
  // every session before it mounts, so a cold start cannot inject into a
  // workspace that has not been whitelisted yet.
  try {
    fs.mkdirSync(MOOD_DIR, { recursive: true })
    let moodConfig = {}
    try {
      moodConfig = JSON.parse(fs.readFileSync(MOOD_CONFIG, 'utf8'))
    } catch {
      /* create a fresh config */
    }
    moodConfig.targetSession = OFF_TARGET
    fs.writeFileSync(MOOD_CONFIG, JSON.stringify(moodConfig, null, 2), 'utf8')
  } catch {
    /* mood will still be gated by the HTTP config below */
  }

  // Merge loading: the two dependencies keep their own source and lifecycle.
  ctx.plugin(fishMemory)
  ctx.plugin(yuMood)

  // fish-memory 1.2.6 declares `remember` with a flat parameter spec while the
  // current DSH tool pipeline expects JSON Schema. Normalize the model-facing
  // schema without touching the dependency's source or execution logic.
  let originalSchemas = null
  try {
    originalSchemas = ctx.tools.schemas.bind(ctx.tools)
    ctx.tools.schemas = (scope) => {
      const list = originalSchemas(scope)
      for (const schema of list) {
        if (schema?.name === 'remember') schema.parameters = REMEMBER_SCHEMA
      }
      return list
    }
  } catch {
    /* the debug route below reports whether the patch could not be installed */
  }
  ctx.effect(() => () => {
    if (!originalSchemas) return
    try {
      ctx.tools.schemas = originalSchemas
    } catch {
      /* best effort */
    }
  })

  function patchRememberDefinition(agent) {
    try {
      const definition = ctx.tools.get('remember', agent)
      if (definition && definition.parameters?.type !== 'object') {
        definition.parameters = REMEMBER_SCHEMA
      }
    } catch {
      /* schema projection patch still covers the request */
    }
  }

  function workspaceOf(agent) {
    try {
      const value = ctx.workingDirectory?.get(agent.session)
      if (typeof value === 'string' && value) return value
    } catch {
      /* fall back to the session header */
    }
    return String(agent?.session?.header?.cwd || '')
  }

  async function post(route, body) {
    const origin = ctx.webServer?.getOrigin?.()
    if (!origin) throw new Error('web server origin unavailable')
    const response = await fetch(origin + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`${route} HTTP ${response.status}`)
    return response.json().catch(() => ({}))
  }

  async function setFish(sid, on) {
    if (!sid || fishEnabled.get(sid) === on) return false
    try {
      await post(FISH_TOGGLE, { session: sid, on })
      fishEnabled.set(sid, on)
      return true
    } catch {
      /* retry on the next tick */
      return false
    }
  }

  async function sync() {
    if (syncing) return
    syncing = true
    try {
      const agents = ctx.agents.list()

      // Start from a clean slate once, then only the focused session may carry
      // fish-memory; background sessions in other workspaces stay untouched.
      if (!resetDone) {
        for (const agent of agents) await setFish(sidOf(agent), false)
        managed.clear()
        resetDone = true
      }

      let current = null
      try {
        current = ctx.agents.currentInitiator?.() ?? null
      } catch {
        /* no active turn */
      }

      const focused = focusSession
        ? agents.find((agent) => sidOf(agent) === focusSession) ?? null
        : null
      const focusedSid = focused ? sidOf(focused) : ''
      if (focused) patchRememberDefinition(focused)
      const focusedEnabled = Boolean(
        focusedSid && whitelist.has(normalizePath(workspaceOf(focused))),
      )

      if (focusedSid) {
        if (focusedEnabled) {
          if (await setFish(focusedSid, true)) {
            managed.add(focusedSid)
            patchRememberDefinition(focused)
          }
        } else {
          await setFish(focusedSid, false)
          managed.delete(focusedSid)
        }
      }
      for (const sid of [...managed]) {
        if (sid === focusedSid) continue
        await setFish(sid, false)
        managed.delete(sid)
      }

      let target = OFF_TARGET
      if (focusedEnabled) target = focusedSid
      else if (current && whitelist.has(normalizePath(workspaceOf(current)))) {
        target = sidOf(current)
      }
      if (target !== lastTarget) {
        try {
          await post(MOOD_CONFIG_ROUTE, { targetSession: target })
          lastTarget = target
        } catch {
          /* retry on the next tick */
        }
      }
    } finally {
      syncing = false
    }
  }

  function sessionTitleFor(sid) {
    const live = ctx.sessions?.get(sid)
    if (live) {
      try {
        const snapshotTitle = ctx.sessionTitle?.get(live)
        if (snapshotTitle?.title) return String(snapshotTitle.title)
      } catch {
        /* fall back to the projection cache */
      }
    }
    try {
      const record = JSON.parse(fs.readFileSync(path.join(SESSION_CACHE_DIR, `${sid}.json`), 'utf8'))
      const value = record?.record?.rows?.title?.val
      const title = typeof value === 'string' ? value : String(value?.title || '')
      if (title) return title
    } catch {
      /* no title cached */
    }
    return ''
  }

  function listSessionRows() {
    const rows = []
    const seen = new Set()
    for (const workspace of readWorkspaces()) {
      for (const sid of workspace.sessionIds) {
        if (seen.has(sid)) continue
        seen.add(sid)
        rows.push({
          sessionId: sid,
          workspaceId: workspace.workspaceId,
          workspace: workspace.title,
          path: workspace.path,
          title: sessionTitleFor(sid),
        })
      }
    }
    return rows
  }

  function snapshot(sessionId) {
    const requested = sessionId ? String(sessionId) : ''
    let agent = requested ? ctx.agents.get(requested) : null
    if (!agent && !requested) {
      try {
        agent = ctx.agents.currentInitiator?.() ?? null
      } catch {
        agent = null
      }
      if (!agent) agent = ctx.agents.list()[0] ?? null
    }
    const sid = agent ? sidOf(agent) : requested
    const workspaceFromRegistry = requested
      ? readWorkspaces().find((row) => row.sessionIds.includes(requested))?.path || ''
      : ''
    const workspace = agent ? workspaceOf(agent) : workspaceFromRegistry
    const normalized = normalizePath(workspace)
    const memory = []
    if (sid) {
      try {
        const store = fishMemory.loadStore(sid)
        for (const item of (store.memories || []).slice(0, 20)) {
          memory.push({
            text: String(item.text || ''),
            importance: Number(item.importance || 0),
            at: item.at || null,
          })
        }
      } catch {
        /* no store yet */
      }
    }
    return {
      sessionId: sid,
      workspace,
      whitelisted: Boolean(normalized && whitelist.has(normalized)),
      whitelist: [...whitelist],
      workspaces: readWorkspaces(),
      sessions: listSessionRows(),
      focusSession,
      memory,
      mood: readMood(),
      target: lastTarget,
      fishEnabled: sid ? fishEnabled.get(sid) === true : false,
      tabRegistered,
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-fish-suite/api/state',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        const sid = url.searchParams.get('session')
        sendJson(res, 200, snapshot(sid))
      } catch (error) {
        sendJson(res, 500, { error: String(error?.message || error) })
      }
    },
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-fish-suite/api/report-tab',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      try {
        const body = await readJson(req)
        tabRegistered = body.registered === true
        sendJson(res, 200, { ok: true, tabRegistered })
      } catch (error) {
        sendJson(res, 400, { error: String(error?.message || error) })
      }
    },
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-fish-suite/api/whitelist',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      try {
        const body = await readJson(req)
        const normalized = normalizePath(body.path)
        if (!normalized) return sendJson(res, 400, { error: 'workspace path required' })
        if (body.enabled === true) whitelist.add(normalized)
        else whitelist.delete(normalized)
        saveState([...whitelist], focusSession)
        await sync()
        sendJson(res, 200, snapshot(body.session))
      } catch (error) {
        sendJson(res, 400, { error: String(error?.message || error) })
      }
    },
  }))

  ctx.on('agent/created', () => {
    void sync()
  })
  ctx.on('agent/disposed', () => {
    void sync()
  })
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-fish-suite/api/focus',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      try {
        const body = await readJson(req)
        const session = String(body.session || '')
        if (!session) return sendJson(res, 400, { error: 'session required' })
        focusSession = session
        saveState([...whitelist], focusSession)
        await sync()
        sendJson(res, 200, snapshot(session))
      } catch (error) {
        sendJson(res, 400, { error: String(error?.message || error) })
      }
    },
  }))
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-fish-suite/api/debug-remember',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        const sid = url.searchParams.get('session')
        const agent = sid ? ctx.agents.get(String(sid)) : null
        const schema = agent
          ? ctx.tools.schemas(agent).find((entry) => entry.name === 'remember') ?? null
          : null
        const definition = agent ? ctx.tools.get('remember', agent) : null
        sendJson(res, 200, {
          sessionId: sid,
          hasAgent: Boolean(agent),
          schema,
          definitionParameters: definition?.parameters ?? null,
          schemaPatched: Boolean(originalSchemas),
        })
      } catch (error) {
        sendJson(res, 500, { error: String(error?.message || error) })
      }
    },
  }))
  ctx.effect(() => ctx.interval(() => {
    void sync()
  }, 1500))

  void sync()
}
