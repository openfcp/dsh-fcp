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

import { readFileSync } from 'node:fs'
import { readFile as readFileAsync } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, realpath, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expertById, EXPERTS, routeTask } from './experts.js'
import {
  resolveDshHome, readSkillState, writeSkillState, scanSharedSkills, mergedInstalledState,
  installFromGithub, installFromSkillhub, uninstallSkill, notifyMutation,
  normalizeSkillFrontmatter, extractZip,
  isValidSkillId as sharedIsValidSkillId,
} from './skills.js'

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

/** Built-in and marketplace ids shipped with this plugin; remote catalog ids are also accepted. */
const KNOWN_SKILL_IDS = new Set([
  'policy-research', 'consumer-protection-review', 'complaint-management',
  'financial-literacy-education', 'consumer-protection-inspection',
  'consumer-protection-annual-evaluation', 'compliance-sales', 'lieflat-gongwen',
  'rayskills', 'official-source-qa', 'law-skills', 'official-document-skill',
  'gongwenformat-pro', 'ai-ppt-skill', 'generate-chart', 'smart-charts',
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


export const inject = ['systemPrompt', 'webServer']

const BIND_ROUTE = '/api/fcp/bind'
const STATE_ROUTE = '/api/fcp/state'
const ROUTE_ROUTE = '/api/fcp/route'
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

/** sessionId → { expertId, at } */
const bindings = new Map()

function bind(sessionId, expertId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  if (!expertById(expertId)) return undefined
  const record = { expertId, at: Date.now() }
  bindings.delete(sessionId)
  bindings.set(sessionId, record)
  while (bindings.size > MAX_BINDINGS) bindings.delete(bindings.keys().next().value)
  return record
}

function bindingOf(sessionId) {
  return typeof sessionId === 'string' ? bindings.get(sessionId) : undefined
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

function contextText(binding) {
  const expert = expertById(binding.expertId)
  if (!expert) return ''
  return [
    `你是「消保工作台」的【${expert.name}】专家。${expert.summary}`,
    '',
    '工作规范：',
    '1. 先查知识库再回答：IMA「国家法律知识库」「八大权益消保知识库」优先；Obsidian（如已授权）其次；引用必须落到文件名/条款/库名，不得编造。',
    '2. 报告、意见书、方案、总结等交付物必须符合规范公文格式（文种、标题层级、结构、引用与附件）；交付前自检。',
    '3. 不确定的条号、金额、案由直接说「以现行有效文件为准」，不虚构；法规废止判断必须有直接依据。',
    '4. 输出先给结论，再给依据与动作；不替监管表态，不出具法律意见。',
    '',
    `可用技能（需要时调用）：${expert.skills.join('、')}`,
    expert.body || '',
  ].join('\n')
}

export function apply(ctx) {
  ctx.systemPrompt.context({
    name: 'fcp:expert',
    order: 320,
    text: ({ agent }) => {
      const sessionId = agent && agent.session ? agent.session.id : undefined
      const binding = bindingOf(sessionId)
      return binding ? contextText(binding) : ''
    },
  })

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
        sendJson(res, { ok: false, error: String(error && error.message ? error.message : error) }, 502)
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
  readJson, loadSkillCatalog,
  scanSharedSkills, mergedInstalledState, notifyMutation,
  normalizeSkillFrontmatter, uninstallSkill, extractZip,
}
