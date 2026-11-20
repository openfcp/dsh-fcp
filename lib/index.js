/**
 * dsh-fcp · 消保工作台 —— Host 半
 *
 * 职责（v0.1）：
 *   1. 保存「会话 → 专家」绑定（POST /api/fcp/bind）
 *   2. 对已绑定会话注入专家人设与工作规范（ctx.systemPrompt.context）
 *   3. 提供专家清单（GET /api/fcp/experts）
 *
 * 只接受 loopback 请求；不落敏感数据。
 */

import { readFileSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { readFile as readFileAsync } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, realpath, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expertById, EXPERTS, routeTask, routeSkills, DEFAULT_SKILL_IDS } from './experts.js'
import {
  resolveDshHome, readSkillState, writeSkillState, scanSharedSkills, mergedInstalledState,
  installFromGithub, installFromSkillhub, uninstallSkill, notifyMutation,
  normalizeSkillFrontmatter, extractZip,
  isValidSkillId as sharedIsValidSkillId,
} from './skills.js'
import {
  readKbConfig, writeKbConfig, addUploadedFile, removeUploadedFile, listUploaded,
  retrieveKnowledge, createKnowledgeTool,
} from './kb.js'

const LOGO_FILE = fileURLToPath(new URL('./logo.png', import.meta.url))
let logoCache
function logoBytes() {
  if (!logoCache) logoCache = readFileSync(LOGO_FILE)
  return logoCache
}

const DSH_HOME = resolveDshHome()
const SHARED_SKILLS_ROOT = join(DSH_HOME, 'skills')

const CATALOG_TTL = 5 * 60 * 1000
let catalogCache = null

async function fetchSkillCatalog() {
  const settled = await Promise.allSettled(SKILL_CATALOG_URLS.map(async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error('catalog HTTP ' + response.status + ' @ ' + url)
    const catalog = await response.json()
    if (!catalog || !Array.isArray(catalog.skills)) throw new Error('catalog payload invalid @ ' + url)
    return { url, catalog }
  }))
  const loaded = settled.filter((item) => item.status === 'fulfilled').map((item) => item.value)
  if (loaded.length === 0) throw new Error(settled.map((item) => item.reason && item.reason.message).filter(Boolean).join('; ') || 'catalog unavailable')
  loaded.sort((a, b) => (b.catalog.skills.length - a.catalog.skills.length) || String(b.catalog.updated || '').localeCompare(String(a.catalog.updated || '')))
  const chosen = loaded[0]
  return { catalog: chosen.catalog, meta: { source: chosen.url.includes('dsh-financial-skills') ? 'dsh-financial-skills' : 'awesome-financial-skills', url: chosen.url, fetchedAt: Date.now() } }
}

async function loadSkillCatalog(options = {}) {
  if (!options.refresh && catalogCache && Date.now() - catalogCache.at < CATALOG_TTL) return catalogCache.value
  const value = await fetchSkillCatalog()
  catalogCache = { at: Date.now(), value }
  return value
}

/** 默认技能 + 其他已知市场技能；远端 catalog 中的 id 也接受。默认清单以 experts.js 为单一事实来源。 */
const KNOWN_SKILL_IDS = new Set([
  ...DEFAULT_SKILL_IDS,
  'official-source-qa', 'law-skills', 'ai-ppt-skill', 'generate-chart', 'smart-charts',
  'aistockresearcher', 'xiaoshuojubenzhuanfenjing',
])

function isValidSkillId(id) {
  return sharedIsValidSkillId(id)
}

async function isKnownSkillId(id) {
  if (!isValidSkillId(id)) return false
  if (KNOWN_SKILL_IDS.has(id)) return true
  try {
    const { catalog } = await loadSkillCatalog()
    return catalog.skills.some((skill) => skill.id === id)
  } catch {
    return false
  }
}

function isValidSkillName(name) {
  return typeof name === 'string' && name.trim() !== '' && name.trim().length <= MAX_SKILL_NAME_LENGTH && !/[\u0000-\u001f\u007f]/.test(name)
}

async function pruneSnapshots() {
  try {
    const entries = await readdir(tmpdir(), { withFileTypes: true })
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(SNAPSHOT_PREFIX) && entry.name.endsWith('.png'))
      .map(async (entry) => {
        const path = join(tmpdir(), entry.name)
        try {
          const info = await stat(path)
          if (info.mtimeMs < cutoff) await unlink(path)
        } catch { /* best effort */ }
      }))
  } catch { /* best effort */ }
}

export const name = 'fcp'


export const inject = ['systemPrompt', 'webServer', 'tools']

const BIND_ROUTE = '/api/fcp/bind'
const STATE_ROUTE = '/api/fcp/state'
const ROUTE_ROUTE = '/api/fcp/route'
const SKILL_ROUTE_ROUTE = '/api/fcp/route-skills'
const SKILL_CATALOG_ROUTE = '/api/fcp/skill-catalog'
const SKILL_CATALOG_URLS = [
  'https://cdn.jsdelivr.net/gh/openfcp/dsh-financial-skills@main/catalog.snapshot.json',
  'https://cdn.jsdelivr.net/gh/openfcp/awesome-financial-skills@main/catalog.json',
]
const EXPERTS_ROUTE = '/api/fcp/experts'
const LOGO_ROUTE = '/api/fcp/logo'
const HERO_ROUTE = '/api/fcp/hero'
const HERO_FILE = fileURLToPath(new URL('../assets/hero.svg', import.meta.url))
const MAX_BINDINGS = 500
const BINDINGS_FILE = join(DSH_HOME, 'storages', 'fcp', 'bindings.json')

/** sessionId → { expertId, at }；内存 Map + 落盘，重启后会话绑定不丢 */
const bindings = new Map()
let bindingsLoaded = false

function loadBindings() {
  if (bindingsLoaded) return
  bindingsLoaded = true
  try {
    const data = JSON.parse(readFileSync(BINDINGS_FILE, 'utf8'))
    const entries = data && Array.isArray(data.bindings) ? data.bindings : []
    for (const entry of entries) {
      if (entry && typeof entry.sessionId === 'string' && expertById(entry.expertId)) {
        bindings.set(entry.sessionId, { expertId: entry.expertId, at: Number(entry.at) || Date.now() })
      }
    }
  } catch { /* 首次运行或文件损坏，从空开始 */ }
}

function persistBindings() {
  try {
    mkdirSync(dirname(BINDINGS_FILE), { recursive: true })
    const entries = Array.from(bindings.entries()).map(([sessionId, record]) => ({ sessionId, expertId: record.expertId, at: record.at }))
    writeFileSync(BINDINGS_FILE, JSON.stringify({ bindings: entries }, null, 2), 'utf8')
    try { chmodSync(BINDINGS_FILE, 0o600) } catch { /* best effort */ }
  } catch { /* 落盘失败不影响本次会话绑定 */ }
}

function bind(sessionId, expertId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  if (!expertById(expertId)) return undefined
  loadBindings()
  const record = { expertId, at: Date.now() }
  bindings.delete(sessionId)
  bindings.set(sessionId, record)
  while (bindings.size > MAX_BINDINGS) bindings.delete(bindings.keys().next().value)
  persistBindings()
  return record
}

function bindingOf(sessionId) {
  if (typeof sessionId !== 'string') return undefined
  loadBindings()
  return bindings.get(sessionId)
}

function isLoopback(req) {
  const address = req.socket && req.socket.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])
const SNAPSHOT_PREFIX = 'fcp-snip-'
const MAX_SNIP_JSON = 8 * 1024 * 1024
const MAX_SNIP_PNG = 6 * 1024 * 1024
const MAX_SKILL_ID_LENGTH = 80
const MAX_SKILL_NAME_LENGTH = 120

function hostnameOf(value) {
  if (typeof value !== 'string' || value === '') return null
  try {
    const hostname = new URL('http://' + value).hostname.toLowerCase()
    return hostname === '' ? null : hostname
  } catch {
    return null
  }
}

function isAllowedHost(req) {
  const headers = req.headers || {}
  return ALLOWED_HOSTNAMES.has(hostnameOf(headers.host || headers[':authority']))
}

function isSameOriginRequest(req) {
  const headers = req.headers || {}
  if (headers['x-fcp-client'] !== '1') return false
  const origin = headers.origin
  if (typeof origin === 'string' && origin !== '') {
    let parsed
    try { parsed = new URL(origin) } catch { return false }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (!ALLOWED_HOSTNAMES.has(parsed.hostname.toLowerCase())) return false
  }
  const site = headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false
  return true
}

function guard(req, res, options = {}) {
  if (!isLoopback(req) || !isAllowedHost(req)) {
    sendJson(res, { ok: false, error: 'forbidden' }, 403)
    return false
  }
  if (options.write && !isSameOriginRequest(req)) {
    sendJson(res, { ok: false, error: 'forbidden: same-origin required' }, 403)
    return false
  }
  return true
}

/** Resolve a directory under homedir only; never escape the home root, including via symlinks. */
async function safeDirectory(requested, home) {
  const target = resolve(isAbsolute(requested) ? requested : join(home, requested))
  const rel = relative(home, target)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) return null
  try {
    const realHome = await realpath(home)
    const realTarget = await realpath(target)
    const realRel = relative(realHome, realTarget)
    if (realRel === '..' || realRel.startsWith('..' + sep) || isAbsolute(realRel)) return null
    return realTarget
  } catch {
    return null
  }
}

function sendJson(res, value, status = 200) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function readJson(req, limit = 64 * 1024) {
  const contentType = String((req.headers || {})['content-type'] || '').toLowerCase()
  if (!contentType.startsWith('application/json')) throw new Error('content-type must be application/json')
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text === '' ? {} : JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/**
 * 知识来源白名单：只对「已绑定 fcp 专家」的工作台会话注入（contextText 有 binding 才返回内容），
 * 绝不影响用户在其他插件/普通会话里使用本机 MCP 内部知识库。
 * 说明：profile 全局注册的 mcp-xiaobao / mcp-rag 会把 instructions 拼进全局 system prompt，
 * 引导模型「先用 search_knowledge_base 检索」；这里以 order 600（最高、拼在最后）明确覆盖该指令。
 */
const KNOWLEDGE_SOURCE_POLICY = '2. 【知识来源白名单·强制】本工作台的知识取证只允许调用工具 fcp_search_knowledge，数据源仅限 IMA 知识库、Obsidian、上传知识库三档。严禁调用任何其他知识检索 / 知识库 / 专家问答工具，尤其包括本机以 MCP 方式挂载的 mcp__xiaobao__search_knowledge_base、mcp__rag__search_kb、mcp__xiaobao__ask_expert 等内部知识库与专家服务（无论其工具名如何变化）；这些服务属于用户的其他插件，不属于本工作台，其返回内容一律不得作为本工作台回答的依据或引用来源。'

function contextText(binding) {
  const expert = expertById(binding && binding.expertId)
  if (!expert) return ''
  return [
    `你是「消保工作台」的【${expert.name}】专家。${expert.summary}`,
    '',
    '工作规范：',
    '1. 【最高优先级·知识取证】只要问题涉及法规、监管规定、条款、出台背景/历史、审查口径、投诉时限、案例依据等任何需要权威出处的内容，必须第一步就调用工具 fcp_search_knowledge 检索，且优先读取 IMA 知识库，之后才是 Obsidian、上传知识库。不得先用记忆或其他知识库回答问题；不得跳过此步骤。引用必须落到具体库名/文件名/条款。若 fcp_search_knowledge 返回「未检索到权威依据」，如实告知用户，不得编造条号、文件名或引用来源。',
    KNOWLEDGE_SOURCE_POLICY,
    '3. 报告、意见书、方案、总结等交付物必须符合规范公文格式（文种、标题层级、结构、引用与附件）；交付前自检。',
    '4. 不确定的条号、金额、案由直接说「以现行有效文件为准」，不虚构；法规废止判断必须有直接依据。',
    '5. 输出先给结论，再给依据与动作；不替监管表态，不出具法律意见。',
    '',
    `可用技能（需要时调用）：${expert.skills.join('、')}`,
    expert.body || '',
  ].join('\n')
}

/**
 * 方案 B：插件启用时把 DEFAULT_SKILL_IDS 真正落盘到共享技能目录 <DSH_HOME>/skills。
 * 幂等（磁盘已有就跳过）、异步（不阻塞启动）、失败静默降级（下次启动重试）。
 * 可通过 options 注入 dshHome / catalog / install / ids，便于离线测试。
 */
async function ensureDefaultSkills(options = {}) {
  const dshHome = options.dshHome || DSH_HOME
  const installRoot = options.installRoot || join(dshHome, 'skills')
  const ids = Array.isArray(options.ids) ? options.ids : DEFAULT_SKILL_IDS
  const logger = options.logger || null
  const results = []

  // 用户显式卸载过的默认技能不再自动装回：卸载路由会把 id 写进 userRemoved
  let userRemoved = new Set()
  try { userRemoved = new Set((await readSkillState(dshHome)).userRemoved || []) } catch { /* 状态不可读时按空处理 */ }
  const desired = ids.filter((id) => !userRemoved.has(id))
  for (const id of ids) if (userRemoved.has(id)) results.push({ id, status: 'user-removed' })

  let onDisk = new Set()
  try {
    onDisk = new Set((await scanSharedSkills(dshHome)).map((item) => item.id))
  } catch { /* 共享目录不存在时视为空 */ }
  for (const id of desired) if (onDisk.has(id)) results.push({ id, status: 'already' })

  const missing = desired.filter((id) => !onDisk.has(id))
  if (missing.length > 0) {
    let catalog = options.catalog
    if (catalog === undefined) {
      try { catalog = (await loadSkillCatalog()).catalog } catch (error) {
        logger?.warn?.('[fcp] 默认技能安装跳过：技能目录不可用 ' + (error?.message || error))
        catalog = null
      }
    }
    if (!catalog) {
      for (const id of missing) results.push({ id, status: 'catalog-unavailable' })
    } else {
      const byId = new Map((catalog.skills || []).map((skill) => [skill.id, skill]))
      const install = options.install || ((skill) => (
        skill.source && skill.source.type === 'skillhub'
          ? installFromSkillhub(skill, installRoot)
          : installFromGithub(skill, installRoot)
      ))
      for (const id of missing) {
        const skill = byId.get(id)
        if (!skill) { results.push({ id, status: 'missing-in-catalog' }); continue }
        try {
          const installed = await install(skill)
          results.push({ id, status: 'installed', path: (installed && installed.path) || '' })
        } catch (error) {
          results.push({ id, status: 'failed', error: String((error && error.message) || error) })
        }
      }
    }
  }

  // 落盘结果写回状态文件，供前端「已安装」视图与跨插件共享
  try {
    const state = await readSkillState(dshHome)
    const ok = new Set(results.filter((item) => item.status === 'installed' || item.status === 'already').map((item) => item.id))
    let changed = false
    for (const id of ok) if (!state.installed.includes(id)) { state.installed.push(id); changed = true }
    if (changed) await writeSkillState(dshHome, state)
  } catch (error) {
    logger?.warn?.('[fcp] 默认技能状态写入失败：' + (error?.message || error))
  }

  // 通知宿主技能注册表立即生效；启动早期服务未就绪时 notifyMutation 内部已降级
  try {
    const paths = results.filter((item) => item.path).map((item) => item.path)
    if (paths.length > 0 && options.ctx) await notifyMutation(options.ctx, logger, paths)
  } catch { /* ignore */ }
  return results
}

export function apply(ctx) {
  ctx.systemPrompt.context({
    name: 'fcp:expert',
    order: 600,
    text: ({ agent }) => {
      const sessionId = agent && agent.session ? agent.session.id : undefined
      const binding = bindingOf(sessionId)
      return binding ? contextText(binding) : ''
    },
  })

  // 方案 B：启用时把默认技能真正安装到共享目录（异步、幂等、失败不阻塞启动）
  ctx.effect(() => {
    let disposed = false
    void ensureDefaultSkills({ ctx, logger: ctx.logger }).then((results) => {
      if (disposed) return
      const installed = results.filter((item) => item.status === 'installed').map((item) => item.id)
      if (installed.length > 0) ctx.logger?.info?.('[fcp] 已自动安装默认技能：' + installed.join('、'))
    }).catch(() => {})
    return () => { disposed = true }
  }, 'fcp: ensure default skills')

  // 注册模型可调用的知识检索工具；若宿主未启用 tools 服务则安全降级
  ctx.effect(() => {
    if (!ctx.tools || typeof ctx.tools.register !== 'function') return undefined
    return ctx.tools.register(createKnowledgeTool(DSH_HOME))
  }, 'fcp: knowledge search tool')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: LOGO_ROUTE,
    handler: (req, res) => {
      if (!guard(req, res, { write: req.method === 'POST' })) return undefined
      if (req.method !== 'GET') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      res.statusCode = 200
      res.setHeader('content-type', 'image/png')
      res.setHeader('cache-control', 'public, max-age=3600')
      res.end(logoBytes())
    },
  }), 'fcp: logo route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: HERO_ROUTE,
    handler: async (req, res) => {
      if (!guard(req, res, { write: req.method === 'POST' })) return undefined
      if (req.method !== 'GET') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      try {
        const svg = await readFileAsync(HERO_FILE)
        res.statusCode = 200
        res.setHeader('content-type', 'image/svg+xml; charset=utf-8')
        res.setHeader('cache-control', 'public, max-age=3600')
        res.end(svg)
      } catch {
        sendJson(res, { ok: false, error: 'hero unavailable' }, 404)
      }
    },
  }), 'fcp: hero route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: EXPERTS_ROUTE,
    handler: (req, res) => {
      if (!guard(req, res, { write: req.method === 'POST' })) return undefined
      if (req.method !== 'GET') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      sendJson(res, { ok: true, value: EXPERTS })
    },
  }), 'fcp: experts route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: BIND_ROUTE,
    handler: async (req, res) => {
      if (!guard(req, res, { write: req.method === 'POST' })) return undefined
      if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      try {
        const body = await readJson(req)
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
        const expertId = typeof body.expertId === 'string' ? body.expertId : ''
        if (sessionId === '' || !expertById(expertId)) {
          return sendJson(res, { ok: false, error: 'invalid sessionId or expertId' }, 400)
        }
        const record = bind(sessionId, expertId)
        sendJson(res, { ok: true, value: { binding: record, expert: expertById(expertId) } })
      } catch (error) {
        sendJson(res, { ok: false, error: String(error && error.message ? error.message : error) }, 400)
      }
    },
  }), 'fcp: bind route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/fcp/snip-save',
    handler: async (req, res) => {
      if (!guard(req, res, { write: req.method === 'POST' })) return undefined
      if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      try {
        const body = await readJson(req, MAX_SNIP_JSON)
        const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : ''
        const match = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl)
        if (match === null) return sendJson(res, { ok: false, error: 'invalid image data' }, 400)
        const bytes = Buffer.from(match[1].replace(/\s/g, ''), 'base64')
        if (bytes.length === 0 || bytes.length > MAX_SNIP_PNG) return sendJson(res, { ok: false, error: 'image too large or empty' }, 400)
        if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return sendJson(res, { ok: false, error: 'invalid png signature' }, 400)
        await pruneSnapshots()
        const target = join(tmpdir(), SNAPSHOT_PREFIX + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png')
        await writeFile(target, bytes)
        sendJson(res, { ok: true, value: { path: target, dataUrl } })
      } catch (error) {
        sendJson(res, { ok: false, error: String(error && error.message ? error.message : error) }, 500)
      }
    },
  }), 'fcp: screenshot save route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/fcp/snip',
    handler: async (req, res) => {
      if (!guard(req, res, { write: req.method === 'POST' })) return undefined
      if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      const target = join(tmpdir(), SNAPSHOT_PREFIX + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png')
      try {
        await pruneSnapshots()
        await new Promise((resolve, reject) => {
          execFile('screencapture', ['-i', '-x', target], { timeout: 120000 }, (error) => {
            if (error) reject(error)
            else resolve()
          })
        })
        const fileStat = await stat(target)
        if (!fileStat.isFile() || fileStat.size === 0) throw new Error('已取消截图')
        const bytes = await readFile(target)
        await new Promise((resolve) => {
          execFile('osascript', ['-e', 'set the clipboard to (read (POSIX file "' + target + '") as «class PNGf»)', ], { timeout: 5000 }, () => resolve())
        })
        sendJson(res, { ok: true, value: { path: target, dataUrl: 'data:image/png;base64,' + bytes.toString('base64') } })
      } catch (error) {
        sendJson(res, { ok: false, error: String(error && error.message ? error.message : error) }, 400)
      }
    },
  }), 'fcp: screenshot route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/fcp/fs-list',
    handler: async (req, res) => {
      if (!guard(req, res, { write: req.method === 'POST' })) return undefined
      if (req.method !== 'GET') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      try {
        const url = new URL(req.url, 'http://127.0.0.1')
        const home = homedir()
        const requested = url.searchParams.get('path') || home
        const target = await safeDirectory(requested, home)
        if (target === null) return sendJson(res, { ok: false, error: 'path outside home directory' }, 403)
        const entries = await readdir(target, { withFileTypes: true })
        const directories = entries
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
          .map((entry) => ({ name: entry.name, path: join(target, entry.name) }))
          .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
        const parent = dirname(target)
        sendJson(res, { ok: true, value: { path: target, parent: parent === target || parent === home ? null : parent, entries: directories } })
      } catch (error) {
        sendJson(res, { ok: false, error: String(error && error.message ? error.message : error) }, 500)
      }
    },
  }), 'fcp: filesystem list route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/fcp/skill-installed',
    handler: async (req, res) => {
      if (!guard(req, res, { write: req.method === 'POST' })) return undefined
      if (req.method !== 'GET') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      try {
        // 合并「共享技能目录磁盘事实」+ 自己的状态文件：另一插件安装的技能也立即显示
        const merged = await mergedInstalledState(DSH_HOME)
        sendJson(res, { ok: true, value: merged })
      } catch (error) {
        sendJson(res, { ok: false, error: String(error && error.message ? error.message : error) }, 500)
      }
    },
  }), 'fcp: installed skills route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/fcp/ima-kbs',
    handler: async (req, res) => {
      if (!guard(req, res, { write: req.method === 'POST' })) return undefined
      if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      try {
        const body = await readJson(req)
        const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
        const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
        if (apiKey === '' || clientId === '') return sendJson(res, { ok: false, error: 'API Key 和 Client ID 都需要填写' }, 400)
        const response = await fetch('https://ima.qq.com/openapi/wiki/v1/search_knowledge_base', {
          method: 'POST',
          signal: AbortSignal.timeout(15000),
          headers: {
            'ima-openapi-clientid': clientId,
            'ima-openapi-apikey': apiKey,
            'ima-openapi-ctx': 'skill_version=1.1.10',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ query: '', cursor: '', limit: 20 }),
        })
        const data = await response.json()
        if (!data || data.code !== 0) {
          const code = data && data.code
          const message = code === 200002 ? 'IMA 凭证无效或已过期，请重新获取 API Key / Client ID' : ((data && data.msg) || 'IMA 返回错误')
          throw new Error(message)
        }
        const list = data.data && Array.isArray(data.data.info_list) ? data.data.info_list : []
        const knowledgeBases = list.map((item) => {
          const kb = item && (item.knowledge_base || item.knowledgeBase || item.kb) || {}
          const id = item && (item.id || item.knowledge_base_id || item.knowledgeBaseId || item.kb_id || kb.id || kb.knowledge_base_id) || ''
          const name = item && (item.name || item.knowledge_base_name || item.knowledgeBaseName || item.kb_name || item.title || kb.name || kb.knowledge_base_name) || ''
          return { id: String(id), name: String(name), description: (item && (item.description || kb.description)) || '', coverUrl: (item && (item.cover_url || kb.cover_url)) || '' }
        })
        sendJson(res, { ok: true, value: { knowledgeBases } })
      } catch (error) {
        sendJson(res, { ok: false, error: String(error && error.message ? error.message : error) }, 502)
      }
    },
  }), 'fcp: ima knowledge bases route')

  // 知识配置同步：浏览器半把凭证/选中库/vault 落到 Host，供工具检索时读取
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/fcp/kb-config',
    handler: async (req, res) => {
      if (!guard(req, res, { write: req.method === 'POST' })) return undefined
      if (req.method === 'GET') {
        try {
          const config = await readKbConfig(DSH_HOME)
          // 不回传明文凭证，仅回传配置状态与库元信息
          sendJson(res, { ok: true, value: {
            ima: { configured: config.ima.configured, clientId: config.ima.clientId, selectedKbs: config.ima.selectedKbs, kbs: config.ima.kbs },
            obsidian: config.obsidian,
            updatedAt: config.updatedAt,
          } })
        } catch (error) {
          sendJson(res, { ok: false, error: String(error && error.message ? error.message : error) }, 500)
        }
        return undefined
      }
      if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      try {
        const body = await readJson(req)
        const config = await writeKbConfig(DSH_HOME, {
          ima: body.ima || {},
          obsidian: body.obsidian || {},
        })
        sendJson(res, { ok: true, value: { updatedAt: config.updatedAt } })
      } catch (error) {
        sendJson(res, { ok: false, error: String(error && error.message ? error.message : error) }, 500)
      }
    },
  }), 'fcp: kb config route')

  // 上传知识库：Markdown 文本或 zip 知识包（base64）
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/fcp/kb-upload',
    handler: async (req, res) => {
      if (!guard(req, res, { write: true })) return undefined
      if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      try {
        const body = await readJson(req, 40 * 1024 * 1024)
        const name = typeof body.name === 'string' ? body.name.slice(0, 200) : ''
        const text = typeof body.text === 'string' ? body.text : undefined
        const base64 = typeof body.base64 === 'string' ? body.base64 : undefined
        if (name === '' || (text === undefined && base64 === undefined)) {
          return sendJson(res, { ok: false, error: '缺少文件名或内容' }, 400)
        }
        const value = await addUploadedFile(DSH_HOME, { name, text, base64 })
        sendJson(res, { ok: true, value })
      } catch (error) {
        sendJson(res, { ok: false, error: String(error && error.message ? error.message : error) }, 400)
      }
    },
  }), 'fcp: kb upload route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/fcp/kb-list',
    handler: async (req, res) => {
      if (!guard(req, res, { write: req.method === 'POST' })) return undefined
      if (req.method !== 'GET') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      try {
        sendJson(res, { ok: true, value: await listUploaded(DSH_HOME) })
      } catch (error) {
        sendJson(res, { ok: false, error: String(error && error.message ? error.message : error) }, 500)
      }
    },
  }), 'fcp: kb list route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/fcp/kb-remove',
    handler: async (req, res) => {
      if (!guard(req, res, { write: true })) return undefined
      if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      try {
        const body = await readJson(req)
        const id = typeof body.id === 'string' ? body.id : ''
        const value = await removeUploadedFile(DSH_HOME, id)
        sendJson(res, { ok: true, value })
      } catch (error) {
        sendJson(res, { ok: false, error: String(error && error.message ? error.message : error) }, 400)
      }
    },
  }), 'fcp: kb remove route')

  // 本地检索预览：让设置页可验证三档检索是否命中
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/fcp/kb-search',
    handler: async (req, res) => {
      if (!guard(req, res, { write: req.method === 'POST' })) return undefined
      if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      try {
        const body = await readJson(req)
        const query = typeof body.query === 'string' ? body.query : ''
        if (query.trim() === '') return sendJson(res, { ok: false, error: 'empty query' }, 400)
        sendJson(res, { ok: true, value: await retrieveKnowledge(DSH_HOME, query) })
      } catch (error) {
        sendJson(res, { ok: false, error: String(error && error.message ? error.message : error) }, 500)
      }
    },
  }), 'fcp: kb search route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SKILL_CATALOG_ROUTE,
    handler: async (req, res) => {
      if (!guard(req, res, { write: req.method === 'POST' })) return undefined
      if (req.method !== 'GET') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      try {
        const { installed: installedIds } = await mergedInstalledState(DSH_HOME)
        const refresh = new URL(req.url, 'http://127.0.0.1').searchParams.get('refresh') === '1'
        const { catalog, meta } = await loadSkillCatalog({ refresh })
        const installed = new Set(installedIds)
        const skills = catalog.skills.map((skill) => ({ ...skill, installed: installed.has(skill.id) }))
        sendJson(res, { ok: true, value: { catalog: { ...catalog, skills }, meta, installed: installedIds } })
      } catch (error) {
        // 远端技能目录拉取失败时仍返回本地磁盘安装事实，前端才能用 fallback 列表
        // 显示正确的「已安装」状态，而不是把没落盘的技能假装成已安装
        try {
          const { installed: installedIds } = await mergedInstalledState(DSH_HOME)
          sendJson(res, { ok: true, value: {
            catalog: { skills: [] },
            meta: { source: 'offline', offline: true },
            installed: installedIds,
            warning: String((error && error.message) || error),
          } })
        } catch {
          sendJson(res, { ok: false, error: String(error && error.message ? error.message : error) }, 502)
        }
      }
    },
  }), 'fcp: skill catalog route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/fcp/skill-install',
    handler: async (req, res) => {
      if (!guard(req, res, { write: req.method === 'POST' })) return undefined
      if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      try {
        const body = await readJson(req)
        const id = typeof body.id === 'string' ? body.id.trim() : ''
        if (!isValidSkillId(id) || id.length > MAX_SKILL_ID_LENGTH) return sendJson(res, { ok: false, error: 'invalid id' }, 400)
        if (!(await isKnownSkillId(id))) return sendJson(res, { ok: false, error: 'unknown skill id' }, 400)
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (name !== '' && !isValidSkillName(name)) return sendJson(res, { ok: false, error: 'invalid skill name' }, 400)

        // 真安装：把技能文件落到共享 <DSH_HOME>/skills/<id>/，两插件互通
        const { catalog } = await loadSkillCatalog()
        const skill = catalog.skills.find((item) => item.id === id)
        const shared = await scanSharedSkills(DSH_HOME)
        const alreadyOnDisk = shared.some((item) => item.id === id)
        let result
        if (!alreadyOnDisk && skill) {
          result = skill.source && skill.source.type === 'skillhub'
            ? await installFromSkillhub(skill, SHARED_SKILLS_ROOT)
            : await installFromGithub(skill, SHARED_SKILLS_ROOT)
        }

        // 兼容旧状态文件（client 读 installed / names）
        const state = await readSkillState(DSH_HOME)
        if (!state.installed.includes(id)) state.installed.push(id)
        // 用户又主动装回来：清除「不要自动安装」标记
        if (Array.isArray(state.userRemoved)) state.userRemoved = state.userRemoved.filter((item) => item !== id)
        const finalName = (skill && (skill.name && (skill.name.zh || skill.name.en))) || name || ''
        if (finalName !== '' && isValidSkillName(finalName)) state.names[id] = finalName
        await writeSkillState(DSH_HOME, state)

        // 装完立即通知宿主技能注册表；拿不到服务时安全降级
        if (result && result.path) await notifyMutation(ctx, ctx.logger, [result.path])
        sendJson(res, { ok: true, value: { installed: state.installed, realInstall: Boolean(result), invocationName: result && result.invocationName || '' } })
      } catch (error) {
        const status = error && error.code === 'CONFLICT' ? 409 : 500
        sendJson(res, { ok: false, error: String(error && error.message ? error.message : error) }, status)
      }
    },
  }), 'fcp: skill install route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/fcp/skill-uninstall',
    handler: async (req, res) => {
      if (!guard(req, res, { write: req.method === 'POST' })) return undefined
      if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      try {
        const body = await readJson(req)
        const id = typeof body.id === 'string' ? body.id.trim() : ''
        if (!isValidSkillId(id) || id.length > MAX_SKILL_ID_LENGTH) return sendJson(res, { ok: false, error: 'invalid id' }, 400)
        let trashedTo
        try {
          const result = await uninstallSkill(id, SHARED_SKILLS_ROOT)
          trashedTo = result.trashedTo
        } catch (error) {
          if (!/未安装/.test(error && error.message ? error.message : '')) throw error
        }
        const state = await readSkillState(DSH_HOME)
        state.installed = state.installed.filter((item) => item !== id)
        if (state.names) delete state.names[id]
        // 记住用户主动卸载，避免下次启动被默认技能自动安装装回来
        if (!Array.isArray(state.userRemoved)) state.userRemoved = []
        if (!state.userRemoved.includes(id)) state.userRemoved.push(id)
        await writeSkillState(DSH_HOME, state)
        await notifyMutation(ctx, ctx.logger, trashedTo ? [trashedTo] : [])
        sendJson(res, { ok: true, value: { installed: state.installed, trashedTo: trashedTo || null } })
      } catch (error) {
        sendJson(res, { ok: false, error: String(error && error.message ? error.message : error) }, 500)
      }
    },
  }), 'fcp: skill uninstall route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/fcp/skill-detail',
    handler: async (req, res) => {
      if (!guard(req, res, { write: req.method === 'POST' })) return undefined
      if (req.method !== 'GET') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      try {
        const url = new URL(req.url, 'http://127.0.0.1')
        const id = url.searchParams.get('id') || ''
        const { catalog } = await loadSkillCatalog()
        const skill = catalog.skills.find((item) => item.id === id)
        if (!skill) return sendJson(res, { ok: false, error: 'unknown skill' }, 404)
        sendJson(res, { ok: true, value: { id: skill.id, version: skill.version || '', license: skill.license || '', source: skill.source || null, author: skill.author || '', tags: skill.tags || [], summary: skill.summary || null, markdown: '' } })
      } catch (error) {
        sendJson(res, { ok: false, error: String(error && error.message ? error.message : error) }, 502)
      }
    },
  }), 'fcp: skill detail route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_ROUTE,
    handler: async (req, res) => {
      if (!guard(req, res, { write: req.method === 'POST' })) return undefined
      if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      try {
        const body = await readJson(req)
        const text = typeof body.text === 'string' ? body.text : ''
        if (text.trim() === '') return sendJson(res, { ok: false, error: 'empty text' }, 400)
        const result = routeTask(text)
        sendJson(res, { ok: true, value: { ...result, expert: expertById(result.expertId) } })
      } catch (error) {
        sendJson(res, { ok: false, error: String(error && error.message ? error.message : error) }, 400)
      }
    },
  }), 'fcp: route route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SKILL_ROUTE_ROUTE,
    handler: async (req, res) => {
      if (!guard(req, res, { write: req.method === 'POST' })) return undefined
      if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      try {
        const body = await readJson(req)
        const text = typeof body.text === 'string' ? body.text : ''
        if (text.trim() === '') return sendJson(res, { ok: false, error: 'empty text' }, 400)
        const result = routeSkills(text)
        // 只把真正落盘的技能送进会话；离线/未装成时不让模型加载不存在的技能
        let allowed = null
        try { allowed = new Set((await scanSharedSkills(DSH_HOME)).map((item) => item.id)) } catch { /* 允许全部 */ }
        const value = allowed
          ? { ...result, skillIds: result.skillIds.filter((id) => allowed.has(id)), matched: result.matched.filter((item) => allowed.has(item.id)) }
          : result
        sendJson(res, { ok: true, value })
      } catch (error) {
        sendJson(res, { ok: false, error: String(error && error.message ? error.message : error) }, 400)
      }
    },
  }), 'fcp: skill route route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATE_ROUTE,
    handler: (req, res) => {
      if (!guard(req, res, { write: req.method === 'POST' })) return undefined
      if (req.method !== 'GET') return sendJson(res, { ok: false, error: 'method not allowed' }, 405)
      const url = new URL(req.url, 'http://localhost')
      const sessionId = url.searchParams.get('sessionId') || ''
      const binding = bindingOf(sessionId)
      sendJson(res, { ok: true, value: { binding: binding ?? null, expert: binding ? expertById(binding.expertId) : null } })
    },
  }), 'fcp: state route')
}

/** Exported for the local test suite; not part of the plugin's runtime API. */
export const _internal = {
  hostnameOf, isLoopback, isAllowedHost, isSameOriginRequest, guard,
  safeDirectory, isValidSkillId, isKnownSkillId, isValidSkillName,
  readJson, loadSkillCatalog, routeSkills, contextText, KNOWLEDGE_SOURCE_POLICY,
  DEFAULT_SKILL_IDS, ensureDefaultSkills,
  scanSharedSkills, mergedInstalledState, notifyMutation,
  normalizeSkillFrontmatter, uninstallSkill, extractZip,
  readKbConfig, writeKbConfig, addUploadedFile, removeUploadedFile, listUploaded, retrieveKnowledge, createKnowledgeTool,
}
