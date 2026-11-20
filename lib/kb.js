/**
 * dsh-fcp · 知识检索核心（Host 端）
 *
 * 提供三档检索，顺序固定：IMA 知识库 → Obsidian → 上传知识库。
 * 全部为本机/用户自配数据源，换一台电脑只要重新配置凭证或重新上传即可用，
 * 不依赖任何本机预装的 rag / xiaobao MCP 知识库。
 *
 * 同时导出 createKnowledgeTool()：向 DSH 注册一个模型真正可调用的检索工具，
 * 让「查 IMA」从一句自然语言指令变成可执行能力。
 */
import { chmod, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { extractZip, resolveDshHome } from './skills.js'

const IMA_ENDPOINT = 'https://ima.qq.com/openapi/wiki/v1/search_knowledge'
const MAX_MD_BYTES = 2 * 1024 * 1024
const MAX_ZIP_BYTES = 25 * 1024 * 1024
const MAX_CHUNKS_PER_FILE = 400
const MAX_INDEX_CHARS = 4 * 1024 * 1024
const MAX_OBSIDIAN_FILES = 2000
const MAX_OBSIDIAN_FILE_CHARS = 8000

export function kbRoot(dshHome) {
  return join(resolveDshHome(dshHome), 'storages', 'fcp', 'kb')
}
export function kbConfigFile(dshHome) {
  return join(resolveDshHome(dshHome), 'storages', 'fcp', 'kb-config.json')
}
export function kbIndexFile(dshHome) {
  return join(resolveDshHome(dshHome), 'storages', 'fcp', 'kb-index.json')
}

function defaultConfig() {
  return {
    ima: { apiKey: '', clientId: '', configured: false, selectedKbs: [], kbs: [] },
    obsidian: { vault: '', configured: false },
    updatedAt: 0,
  }
}

function normalizeConfig(input) {
  const base = defaultConfig()
  const ima = input && input.ima && typeof input.ima === 'object' ? input.ima : {}
  const obs = input && input.obsidian && typeof input.obsidian === 'object' ? input.obsidian : {}
  const cleanKb = (k) => ({
    id: String((k && (k.id || k.knowledge_base_id)) || ''),
    name: String((k && (k.name || k.title || k.knowledge_base_name)) || ''),
  })
  return {
    ima: {
      apiKey: typeof ima.apiKey === 'string' ? ima.apiKey.slice(0, 512) : '',
      clientId: typeof ima.clientId === 'string' ? ima.clientId.slice(0, 512) : '',
      configured: ima.configured === true,
      selectedKbs: Array.isArray(ima.selectedKbs) ? ima.selectedKbs.filter((x) => typeof x === 'string' && x !== '').slice(0, 100).map(String) : [],
      kbs: Array.isArray(ima.kbs) ? ima.kbs.slice(0, 100).map(cleanKb).filter((k) => k.id !== '') : [],
    },
    obsidian: {
      vault: typeof obs.vault === 'string' ? obs.vault.slice(0, 2048) : '',
      configured: obs.configured === true,
    },
    updatedAt: Date.now(),
  }
}

export async function readKbConfig(dshHome) {
  const file = kbConfigFile(dshHome)
  try {
    const text = await readFile(file, 'utf8')
    const parsed = JSON.parse(text)
    return normalizeConfig(parsed)
  } catch {
    return defaultConfig()
  }
}

export async function writeKbConfig(dshHome, input) {
  const file = kbConfigFile(dshHome)
  await mkdir(dirname(file), { recursive: true })
  const config = normalizeConfig(input)
  await writeFile(file, JSON.stringify(config, null, 2), 'utf8')
  try { await chmod(file, 0o600) } catch { /* best effort on non-posix */ }
  return config
}

async function readIndex(dshHome) {
  const file = kbIndexFile(dshHome)
  try {
    const data = JSON.parse(await readFile(file, 'utf8'))
    return { files: Array.isArray(data.files) ? data.files : [] }
  } catch {
    return { files: [] }
  }
}

async function writeIndex(dshHome, index) {
  const file = kbIndexFile(dshHome)
  await mkdir(dirname(file), { recursive: true })
  let total = 0
  const files = []
  for (const item of index.files) {
    if (total >= MAX_INDEX_CHARS) break
    const chunks = []
    for (const ch of item.chunks || []) {
      const text = String(ch.text || '').slice(0, 2000)
      if (total + text.length > MAX_INDEX_CHARS) break
      total += text.length
      chunks.push({ file: String(ch.file || ''), text })
    }
    if (chunks.length === 0) continue
    files.push({ id: item.id, name: item.name, size: Number(item.size) || 0, at: Number(item.at) || Date.now(), chunks })
  }
  await writeFile(file, JSON.stringify({ files }, null, 2), 'utf8')
}

/** 中文按二字切片、英文按词，够用且零依赖。 */
export function tokenize(text) {
  const s = String(text || '').toLowerCase()
  const tokens = []
  for (const match of s.matchAll(/[a-z0-9]{2,}/g)) tokens.push(match[0])
  const cjk = s.replace(/[^\u4e00-\u9fff]/g, '')
  for (let i = 0; i < cjk.length - 1; i += 1) tokens.push(cjk.slice(i, i + 2))
  return tokens
}

export function scoreMatch(query, text) {
  const qt = tokenize(query)
  if (qt.length === 0) return 0
  const tt = new Set(tokenize(text))
  let score = 0
  for (const token of qt) if (tt.has(token)) score += 1
  return score
}

export function buildChunks(text, maxChars = 1200) {
  const clean = String(text || '').replace(/\r\n/g, '\n')
  const paras = clean.split(/\n{2,}/)
  const chunks = []
  let buf = ''
  for (const para of paras) {
    if (buf.length > 0 && buf.length + para.length > maxChars) {
      chunks.push(buf.trim()); buf = ''
    }
    buf += (buf ? '\n' : '') + para
    if (buf.length > maxChars * 2) { chunks.push(buf.trim()); buf = '' }
  }
  if (buf.trim()) chunks.push(buf.trim())
  return chunks.slice(0, MAX_CHUNKS_PER_FILE)
}

function excerptAround(query, text) {
  const tokens = tokenize(query)
  let pos = -1
  const lower = text.toLowerCase()
  for (const token of tokens) {
    const index = lower.indexOf(token)
    if (index >= 0) { pos = index; break }
  }
  if (pos < 0) return text.slice(0, 600)
  const start = Math.max(0, pos - 120)
  return (start > 0 ? '…' : '') + text.slice(start, start + 600)
}

/** 上传一个 Markdown 文本或 zip 知识包，落盘并重建索引。 */
export async function addUploadedFile(dshHome, { name, text, base64 }) {
  const root = kbRoot(dshHome)
  await mkdir(root, { recursive: true })
  const id = 'kb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
  const dir = join(root, id)
  await mkdir(dir, { recursive: true })

  const entries = []
  let size = 0
  try {
    if (typeof base64 === 'string' && base64 !== '') {
      const buf = Buffer.from(base64, 'base64')
      if (buf.length > MAX_ZIP_BYTES) throw new Error('知识包超过 25MB 上限')
      const files = extractZip(buf)
      const docs = files.filter((f) => /\.(md|markdown|txt|text)$/i.test(f.path))
      if (docs.length === 0) throw new Error('知识包中没有 Markdown / 文本文件')
      for (const f of docs) {
        if (f.buffer.length > MAX_MD_BYTES) continue
        await writeFile(join(dir, f.path), f.buffer)
        entries.push({ path: f.path, text: f.buffer.toString('utf8') })
        size += f.buffer.length
      }
    } else {
      const body = Buffer.from(typeof text === 'string' ? text : '', 'utf8')
      if (body.length > MAX_MD_BYTES) throw new Error('单个文件超过 2MB 上限')
      const safeName = String(name || 'note.md').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 160) || 'note.md'
      await writeFile(join(dir, safeName), body)
      entries.push({ path: safeName, text: body.toString('utf8') })
      size += body.length
    }
    if (entries.length === 0) throw new Error('没有可索引的文档')

    const chunks = []
    for (const entry of entries) {
      for (const chunk of buildChunks(entry.text)) chunks.push({ file: entry.path, text: chunk })
    }
    const index = await readIndex(dshHome)
    index.files.push({ id, name: String(name || '知识文件').slice(0, 160), size, at: Date.now(), chunks })
    await writeIndex(dshHome, index)
    return { id, name: String(name || '知识文件').slice(0, 160), size, files: entries.length, chunks: chunks.length }
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

export async function removeUploadedFile(dshHome, id) {
  if (typeof id !== 'string' || !/^kb-[a-z0-9-]+$/i.test(id)) throw new Error('invalid id')
  const index = await readIndex(dshHome)
  const exists = index.files.some((f) => f.id === id)
  if (!exists) return { removed: false }
  index.files = index.files.filter((f) => f.id !== id)
  await writeIndex(dshHome, index)
  await rm(join(kbRoot(dshHome), id), { recursive: true, force: true }).catch(() => {})
  return { removed: true }
}

export async function listUploaded(dshHome) {
  const index = await readIndex(dshHome)
  return index.files.map((f) => ({ id: f.id, name: f.name, size: f.size, at: f.at, chunks: (f.chunks || []).length }))
}

export async function searchUploaded(dshHome, query, limit = 5) {
  const index = await readIndex(dshHome)
  const out = []
  for (const file of index.files) {
    let best = null
    for (const chunk of file.chunks || []) {
      const score = scoreMatch(query, chunk.text)
      if (score > 0 && (best === null || score > best.score)) best = { score, text: chunk.text, file: chunk.file }
    }
    if (best) out.push({ title: file.name + (best.file ? ' · ' + best.file : ''), excerpt: best.text.slice(0, 600), score: best.score })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}

async function collectMarkdown(root) {
  const out = []
  const queue = [root]
  while (queue.length > 0 && out.length < MAX_OBSIDIAN_FILES) {
    const dir = queue.shift()
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (out.length >= MAX_OBSIDIAN_FILES) break
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { queue.push(full); continue }
      if (entry.isFile() && /\.md$/i.test(entry.name)) out.push(full)
    }
  }
  return out
}

export async function searchObsidian(vault, query, limit = 5) {
  if (typeof vault !== 'string' || vault.trim() === '') return []
  let root
  try { root = await realpath(resolve(vault.replace(/^~/, homedir()))) } catch { return [] }
  const files = await collectMarkdown(root)
  const out = []
  for (const file of files) {
    let text
    try { text = (await readFile(file, 'utf8')).slice(0, MAX_OBSIDIAN_FILE_CHARS) } catch { continue }
    const score = scoreMatch(query, text)
    if (score > 0) out.push({ title: relative(root, file), excerpt: excerptAround(query, text), score })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}

/**
 * IMA search_knowledge 是「精确短语匹配」，不做分词。
 * 模型直接传整句（如「适当性管理 投资者适当性 发展脉络 监管规定」）必然 0 条，
 * 因此把长句拆成可命中的短词，按优先级多轮尝试。
 */
export function rewriteImaQueries(query) {
  const q = String(query || '').trim()
  if (q === '') return []
  const queries = []
  const push = (value) => {
    const s = String(value || '').trim()
    if (s.length >= 2 && !queries.includes(s)) queries.push(s)
  }
  push(q)
  for (const piece of q.split(/[\s,，、;；/|\\（）()【】\[\]「」《》"''：:]+/)) push(piece)
  // 中文长词再取 2/3/4 字前缀，扩大命中面（IMA 为精确短语匹配）
  for (const piece of queries.slice(1, 4)) {
    if (piece.length > 2) push(piece.slice(0, 2))
    if (piece.length > 3) push(piece.slice(0, 3))
    if (piece.length > 4) push(piece.slice(0, 4))
  }
  return queries.slice(0, 10)
}

export async function searchIma(ima, query, signal, limit = 5) {
  if (!ima || !ima.apiKey || !ima.clientId) return []
  const ids = []
  const pushId = (id) => { const s = String(id || ''); if (s !== '' && !ids.includes(s)) ids.push(s) }
  for (const id of ima.selectedKbs || []) pushId(id)
  for (const kb of ima.kbs || []) if (/国家法律|八大权益|消保|金融|法规|政策/.test(kb.name || '')) pushId(kb.id)
  if (ids.length === 0) return []

  const queries = rewriteImaQueries(query)
  if (queries.length === 0) return []
  const out = []
  const seen = new Set()
  const collect = (id, list) => {
    const kb = (ima.kbs || []).find((k) => k.id === id)
    const kbName = (kb && kb.name) || id
    for (const item of (Array.isArray(list) ? list : [])) {
      const title = String(item.title || '未命名条目') + ' · ' + kbName
      const excerpt = String(item.highlight_content || '').slice(0, 600)
      const key = title + '|' + excerpt.slice(0, 80)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ title, excerpt, score: 10 })
    }
  }
  const queryOne = async (id, q) => {
    if (signal && signal.aborted) return []
    try {
      const response = await fetch(IMA_ENDPOINT, {
        method: 'POST',
        signal: signal || AbortSignal.timeout(12000),
        headers: {
          'ima-openapi-clientid': ima.clientId,
          'ima-openapi-apikey': ima.apiKey,
          'ima-openapi-ctx': 'skill_version=1.1.10',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ query: q, cursor: '', knowledge_base_id: id }),
      })
      const data = await response.json()
      if (data && data.code === 0) {
        return data.data && Array.isArray(data.data.info_list) ? data.data.info_list : []
      }
    } catch { /* 单个库/词失败不影响整体降级 */ }
    return []
  }

  // 第一轮：原句 × 常见库（最多 3 个）
  for (const id of ids.slice(0, 3)) {
    collect(id, await queryOne(id, queries[0]))
    if (out.length >= limit * 2) break
  }
  // 第二轮：短词 × 首选库（用户勾选的库优先），长句在这里被拆开命中
  if (out.length < limit) {
    for (const q of queries.slice(1)) {
      collect(ids[0], await queryOne(ids[0], q))
      if (out.length >= limit * 2) break
    }
  }
  // 第三轮：仍无结果时，用次短词扩展到其他核心库
  if (out.length === 0 && queries.length > 1) {
    for (const id of ids.slice(1, 3)) {
      collect(id, await queryOne(id, queries[1]))
      if (out.length >= limit * 2) break
    }
  }
  return out.slice(0, limit)
}

/**
 * 三档顺序检索：IMA → Obsidian → 上传知识库。
 * 任何一档命中即收集；全部落空时明确返回「未检索到」，杜绝模型编造引用。
 */
/**
 * 将内部检索结果收敛为工具 output schema 声明的字段。
 * score 等内部排序字段必须在此剥离：output schema 为 additionalProperties:false，
 * 多余字段会让 DSH 判整个工具调用为 schema 校验失败，导致已查到的 IMA/Obsidian
 * 结果全部丢失。
 */
export function normalizeSources(items) {
  return (Array.isArray(items) ? items : []).slice(0, 8).map((item) => ({
    source: String((item && item.source) || '知识库'),
    title: String((item && item.title) || ''),
    excerpt: String((item && item.excerpt) || ''),
  }))
}

export async function retrieveKnowledge(dshHome, query, signal) {
  const q = String(query || '').trim()
  if (q === '') return { found: false, sources: [], guidance: '检索词为空。' }
  const config = await readKbConfig(dshHome)
  const sources = []

  if (config.ima.configured && config.ima.apiKey !== '' && config.ima.clientId !== '') {
    try {
      for (const hit of await searchIma(config.ima, q, signal)) sources.push({ source: 'IMA 知识库', ...hit })
    } catch { /* 降级到下一档 */ }
  }
  if (config.obsidian.configured && config.obsidian.vault !== '') {
    try {
      for (const hit of await searchObsidian(config.obsidian.vault, q)) sources.push({ source: 'Obsidian', ...hit })
    } catch { /* 降级到下一档 */ }
  }
  try {
    for (const hit of await searchUploaded(dshHome, q)) sources.push({ source: '上传知识库', ...hit })
  } catch { /* 已到最后一档 */ }

  if (sources.length === 0) {
    return {
      found: false,
      sources: [],
      guidance: '未在 IMA、Obsidian 或上传知识库中检索到相关内容。请明确告知用户「未检索到权威依据」，不得编造条款号、文件名或引用来源；如需精确依据，请在设置中配置 IMA 凭证、绑定 Obsidian vault 或上传知识库。',
    }
  }
  return {
    found: true,
    sources: normalizeSources(sources),
    guidance: '以上为知识库检索片段，引用须落到具体库名/文件名/条款；片段仅供参考，法规效力以现行有效文件为准。',
  }
}

/* ---------- 原生工具定义（纯对象，兼容 ctx.tools.register） ---------- */

function compileValueSchema(value) {
  const compiled = {}
  for (const [key, entry] of Object.entries(value || {})) {
    if (key === 'required') continue
    if (key === 'properties' && entry && typeof entry === 'object') {
      const props = {}
      const required = []
      for (const [name, child] of Object.entries(entry)) {
        if (child && child.required === true) required.push(name)
        props[name] = compileValueSchema(child)
      }
      compiled.properties = props
      if (required.length > 0) compiled.required = required
    } else if (key === 'items' && entry && typeof entry === 'object') {
      compiled.items = compileValueSchema(entry)
    } else {
      compiled[key] = entry
    }
  }
  return compiled
}

function compileParameters(properties) {
  const compiled = {}
  const required = []
  for (const [name, value] of Object.entries(properties || {})) {
    if (value && value.required === true) required.push(name)
    compiled[name] = compileValueSchema(value)
  }
  return { type: 'object', properties: compiled, ...(required.length ? { required } : {}) }
}

function validateParameters(schema, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['arguments must be an object']
  const violations = []
  for (const name of schema.required || []) if (!(name in value)) violations.push(name + ': required')
  for (const [name, entry] of Object.entries(value)) {
    if (schema.properties[name] && schema.properties[name].type === 'string' && typeof entry !== 'string') violations.push(name + ': expected string')
  }
  return violations
}

function renderResult(_args, value) {
  const lines = []
  if (!value || value.found === false) {
    lines.push('【知识检索】未检索到权威依据。')
    if (value && value.guidance) lines.push(value.guidance)
  } else {
    lines.push('【知识检索】命中 ' + ((value.sources || []).length) + ' 条片段：')
    for (const source of value.sources || []) {
      lines.push('— ' + (source.source || '知识库') + '｜' + (source.title || '') + '\n' + (source.excerpt || ''))
    }
    if (value.guidance) lines.push(value.guidance)
  }
  return [{ type: 'text', text: lines.join('\n\n') }]
}

/** 供 ctx.tools.register 使用的工具定义。 */
export function createKnowledgeTool(dshHome) {
  const parameters = compileParameters({
    query: { type: 'string', required: true, description: '检索关键词或需要查证的问题，例如「金融消费者权益保护实施办法 投诉时限」' },
  })
  const schema = compileValueSchema({
    type: 'object',
    additionalProperties: false,
    properties: {
      found: { type: 'boolean', required: true, description: '是否检索到相关内容' },
      sources: {
        type: 'array', required: true,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            source: { type: 'string', required: true },
            title: { type: 'string', required: true },
            excerpt: { type: 'string' },
            score: { type: 'number', description: '检索匹配分数，仅供排序参考' },
          },
        },
      },
      guidance: { type: 'string' },
    },
  })
  return {
    name: 'fcp_search_knowledge',
    description: '检索金融消保权威依据：按 IMA 知识库 → Obsidian → 上传知识库 顺序查找。回答涉及法规、条款、审查口径、投诉时限等问题前必须调用；未命中时须如实说明，不得编造引用。',
    parameters,
    output: { schema, render: renderResult },
    timeoutMs: 30000,
    async execute(args, exec) {
      const violations = validateParameters(parameters, args)
      if (violations.length > 0) throw new Error('invalid arguments: ' + violations.join('; '))
      return retrieveKnowledge(dshHome, args.query, exec && exec.signal)
    },
  }
}
