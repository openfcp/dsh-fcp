/**
 * dsh-fcp · 技能共享安装层
 *
 * 与 openfcp/dsh-financial-skills 共用 <DSH_HOME>/skills 作为唯一事实来源：
 *   - 真安装：SKILL.md 落盘，装完通知宿主 skills 注册表立即生效
 *   - 只读识别平铺 <id>.md，兼容旧版与其他插件的安装形态
 *   - 零第三方依赖：zip 解压用 node:zlib，网络用 fetch
 */

import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'

export function isValidSkillId(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(id)
}

/** 宿主发现器认可的调用名：kebab-case，否则整条技能被静默丢弃。 */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const PROVENANCE_FILE = '.financial-skills.json'
export const SKILL_FILE = 'SKILL.md'
export const TRASH_DIR = '.trash'

const MAX_FILES = 200
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 16 * 1024 * 1024
const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50

export function resolveDshHome(dshHome) {
  if (typeof dshHome === 'string' && dshHome.trim() !== '') return resolve(dshHome.trim())
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim() !== '') return resolve(env.trim())
  return join(homedir(), '.dsh')
}

export function skillStateFile(dshHome) {
  return join(resolveDshHome(dshHome), 'storages', 'fcp', 'skills-state.json')
}

function unquote(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))) return value.slice(1, -1)
  return value
}

function assertSafeRelPath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 512 &&
    !path.includes('\\') && !path.includes('\0') &&
    path.split('/').every((seg) => seg && seg !== '.' && seg !== '..' && !/[\u0000-\u001f]/.test(seg))
}

function encodeRelPath(path) {
  return String(path || '').split('/')
    .filter((seg) => seg !== '' && seg !== '.')
    .map(encodeURIComponent)
    .join('/')
}

async function isFile(path) {
  try { return (await stat(path)).isFile() } catch { return false }
}

async function isDirectory(path) {
  try { return (await stat(path)).isDirectory() } catch { return false }
}

async function fetchBuffer(url, timeoutMs = 15000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'dsh-fcp/2.0', accept: '*/*' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

function execAsync(cmd, args, opts) {
  return new Promise((resolvePromise, reject) => {
    execFile(cmd, args, opts, (err, stdout) => err ? reject(err) : resolvePromise(stdout))
  })
}

/* ---------- frontmatter ---------- */

export function parseFrontmatter(text) {
  const out = {}
  if (typeof text !== 'string') return out
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (match === null) return out
  const lines = match[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i])
    if (pair === null) continue
    const key = pair[1]
    if ((key !== 'name' && key !== 'description') || out[key] !== undefined) continue
    let rest = pair[2].trim()
    if (rest === '') continue
    if (/^[|>][-+]?$/.test(rest)) {
      const parts = []
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j] === '' || /^\s/.test(lines[j])) parts.push(lines[j].trim())
        else break
      }
      rest = parts.join(' ').trim()
    }
    if (rest !== '') out[key] = unquote(rest)
  }
  return out
}

async function readFrontmatterSafe(file) {
  try { return parseFrontmatter(await readFile(file, 'utf8')) } catch { return {} }
}

export function normalizeSkillFrontmatter(content, id, fallbackDescription = '') {
  const text = typeof content === 'string' ? content : ''
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(text)
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const desc = String(fallbackDescription || '').trim() || id

  if (match === null) {
    const header = `---${nl}name: ${id}${nl}description: ${desc}${nl}---${nl}${nl}`
    return { content: `${header}${text}`, invocationName: id, changed: true }
  }

  const lines = match[1].split(/\r?\n/)
  let invocationName
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(lines[i])
    if (m === null) continue
    if (m[1] === 'name') {
      const raw = unquote(m[2].trim())
      if (SKILL_NAME_PATTERN.test(raw)) {
        invocationName = raw
      } else {
        lines[i] = `name: ${id}`
        invocationName = id
      }
    } else if (m[1] === 'description' && m[2].trim() === '') {
      lines[i] = `description: ${desc}`
    }
  }
  if (invocationName === undefined) {
    lines.unshift(`name: ${id}`)
    invocationName = id
  }
  if (!lines.some((line) => /^description:/.test(line))) lines.push(`description: ${desc}`)
  const rebuilt = `---${nl}${lines.join(nl)}${nl}---${nl}${text.slice(match[0].length)}`
  return { content: rebuilt, invocationName, changed: rebuilt !== text }
}

/* ---------- 共享目录扫描 ---------- */

export async function scanSharedSkills(dshHome) {
  const root = join(resolveDshHome(dshHome), 'skills')
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch { return [] }

  const byId = new Map()
  for (const entry of entries) {
    try {
      if (!entry.isDirectory() || entry.name.startsWith('.') || !isValidSkillId(entry.name)) continue
      const dir = join(root, entry.name)
      const skillFile = join(dir, SKILL_FILE)
      if (!(await isFile(skillFile))) continue
      const fm = await readFrontmatterSafe(skillFile)
      byId.set(entry.name, {
        id: entry.name,
        name: fm.name || entry.name,
        description: fm.description || '',
        path: dir,
        source: 'shared',
      })
    } catch { continue }
  }
  for (const entry of entries) {
    try {
      if (!entry.isFile() || entry.name.startsWith('.') || !entry.name.endsWith('.md')) continue
      const id = entry.name.slice(0, -'.md'.length)
      if (!isValidSkillId(id) || byId.has(id)) continue
      const fm = await readFrontmatterSafe(join(root, entry.name))
      byId.set(id, { id, name: fm.name || id, description: fm.description || '', path: join(root, entry.name), source: 'shared' })
    } catch { continue }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/* ---------- 状态读写与合并 ---------- */

export async function readSkillState(dshHome) {
  try {
    const parsed = JSON.parse(await readFile(skillStateFile(dshHome), 'utf8'))
    return {
      installed: Array.isArray(parsed.installed) ? parsed.installed.filter((id) => typeof id === 'string') : [],
      names: parsed.names && typeof parsed.names === 'object' ? parsed.names : {},
    }
  } catch {
    return { installed: [], names: {} }
  }
}

export async function writeSkillState(dshHome, state) {
  const file = skillStateFile(dshHome)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(state, null, 2), 'utf8')
}

/** 共享目录（磁盘事实）优先 + 自己的状态文件，按 id 合并。 */
export async function mergedInstalledState(dshHome) {
  const [own, shared] = await Promise.all([readSkillState(dshHome), scanSharedSkills(dshHome)])
  const byId = new Map()
  for (const id of own.installed) {
    if (!isValidSkillId(id)) continue
    byId.set(id, { id, name: own.names?.[id] || id, description: '', source: 'fcp-local' })
  }
  for (const item of shared) byId.set(item.id, { ...byId.get(item.id), ...item })
  const skills = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
  return {
    installed: skills.map((s) => s.id),
    names: Object.fromEntries(skills.map((s) => [s.id, s.name])),
    skills,
  }
}

/* ---------- 原子落盘 ---------- */

export async function commitInstall({ id, files, provenance, installRoot }) {
  if (!isValidSkillId(id)) throw new Error('invalid skill id')
  if (!Array.isArray(files) || files.length === 0) throw new Error('empty package')
  if (files.length > MAX_FILES) throw new Error('too many files')
  if (!files.some((f) => f.path === SKILL_FILE)) throw new Error('missing SKILL.md')

  let total = 0
  for (const f of files) {
    if (!assertSafeRelPath(f.path) || !Buffer.isBuffer(f.buffer)) throw new Error('unsafe file: ' + f.path)
    if (f.buffer.length > MAX_FILE_BYTES) throw new Error('file too large: ' + f.path)
    total += f.buffer.length
  }
  if (total > MAX_TOTAL_BYTES) throw new Error('total too large')

  const root = resolve(installRoot)
  const target = join(root, id)
  if (await isDirectory(target)) {
    const err = new Error(`skill ${id} 已安装，如需更新请先卸载`)
    err.code = 'CONFLICT'
    throw err
  }

  const skillFile = files.find((f) => f.path === SKILL_FILE)
  const normalized = normalizeSkillFrontmatter(skillFile.buffer.toString('utf8'), id, provenance.summary || '')
  skillFile.buffer = Buffer.from(normalized.content, 'utf8')

  const stamp = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
  const staging = join(root, `.staging-${id}-${stamp}`)
  await mkdir(staging, { recursive: true })

  try {
    for (const f of files) {
      const dest = join(staging, ...f.path.split('/'))
      if (!dest.startsWith(staging + sep)) throw new Error('path escape: ' + f.path)
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, f.buffer)
    }
    await writeFile(join(staging, PROVENANCE_FILE), JSON.stringify({
      id,
      version: provenance.version || '',
      license: provenance.license || '',
      invocationName: normalized.invocationName,
      installedAt: Date.now(),
      installedBy: 'dsh-fcp',
      files: files.map((f) => f.path),
      fileCount: files.length,
      bytes: total,
      ...provenance,
    }, null, 2), 'utf8')
    await rename(staging, target)
    return { id, path: target, files: files.length, bytes: total, invocationName: normalized.invocationName }
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

/* ---------- GitHub 来源真安装 ---------- */

function applyTemplate(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (_, key) => {
    const value = vars[key] == null ? '' : String(vars[key])
    return (key === 'path' || key === 'file') ? encodeRelPath(value) : encodeURIComponent(value)
  })
}

export async function listGithubFiles(source) {
  const repo = source.repo
  const ref = source.ref || 'main'
  const dir = String(source.path || '').replace(/^\/+|\/+$/g, '')
  try {
    const url = `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`
    const payload = JSON.parse((await fetchBuffer(url)).toString('utf8'))
    if (!Array.isArray(payload.tree)) throw new Error('bad tree payload')
    const prefix = dir ? dir + '/' : ''
    return payload.tree
      .filter((node) => node.type === 'blob' && (!prefix || node.path.startsWith(prefix)))
      .map((node) => ({ path: prefix ? node.path.slice(prefix.length) : node.path, size: node.size || 0 }))
      .filter((f) => assertSafeRelPath(f.path))
  } catch {
    try {
      const url = `https://data.jsdelivr.com/v1/packages/gh/${repo}@${encodeURIComponent(ref)}?structure=flat`
      const payload = JSON.parse((await fetchBuffer(url)).toString('utf8'))
      const prefix = dir ? `/${dir}/` : '/'
      return (Array.isArray(payload.files) ? payload.files : [])
        .filter((f) => f && typeof f.name === 'string' && f.name.startsWith(prefix))
        .map((f) => ({ path: f.name.slice(prefix.length), size: f.size || 0 }))
        .filter((f) => assertSafeRelPath(f.path))
    } catch {
      const out = []
      async function walk(sub) {
        const url = `https://api.github.com/repos/${repo}/contents/${encodeRelPath(sub)}?ref=${encodeURIComponent(ref)}`
        const items = JSON.parse((await fetchBuffer(url)).toString('utf8'))
        for (const item of Array.isArray(items) ? items : []) {
          const p = sub ? `${sub}/${item.name}` : item.name
          if (item.type === 'dir') await walk(p)
          else if (item.type === 'file' && assertSafeRelPath(p)) out.push({ path: p, size: item.size || 0 })
        }
      }
      await walk(dir)
      return out
    }
  }
}

export async function installFromGithub(skill, installRoot) {
  const s = skill.source || {}
  if (s.type !== 'github' || !s.repo) throw new Error('unsupported github source')
  const ref = s.ref || 'main'
  const dir = String(s.path || '').replace(/^\/+|\/+$/g, '')
  const listing = await listGithubFiles(s)
  if (listing.length === 0) throw new Error(`no files for ${skill.id}`)
  const rawTemplate = (skill.resolve && skill.resolve.github && skill.resolve.github.raw) ||
    'https://raw.githubusercontent.com/{repo}/{ref}/{path}/{file}'

  const files = []
  for (const entry of listing) {
    const vars = { repo: s.repo, ref, path: dir, file: entry.path }
    let buffer
    try {
      buffer = await fetchBuffer(applyTemplate(rawTemplate, vars))
    } catch {
      const mirror = `https://fastly.jsdelivr.net/gh/${s.repo}@${encodeURIComponent(ref)}/${encodeRelPath(dir)}/${encodeRelPath(entry.path)}`
      buffer = await fetchBuffer(mirror)
    }
    files.push({ path: entry.path, buffer })
  }

  return commitInstall({
    id: skill.id,
    files,
    provenance: {
      version: skill.version || '',
      license: skill.license || '',
      summary: (skill.summary && (skill.summary.zh || skill.summary.en)) || skill.summary || '',
      sourceType: 'github', sourceRepo: s.repo, sourcePath: dir, sourceRef: ref,
    },
    installRoot,
  })
}

/* ---------- SkillHub 来源真安装（纯 JS unzip + 系统兜底） ---------- */

function findEocd(buf) {
  if (buf.length < 22) return -1
  for (let off = buf.length - 22; off >= Math.max(0, buf.length - 65557); off -= 1) {
    if (buf.readUInt32LE(off) === EOCD_SIG) return off
  }
  return -1
}

export function extractZip(buffer) {
  const eocd = findEocd(buffer)
  if (eocd < 0) throw new Error('invalid zip: no EOCD')
  const count = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error('zip64 unsupported')

  const files = []
  let offset = centralOffset
  let total = 0
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIG) throw new Error('bad central directory')
    const flags = buffer.readUInt16LE(offset + 8)
    const method = buffer.readUInt16LE(offset + 10)
    const compSize = buffer.readUInt32LE(offset + 20)
    const nameLen = buffer.readUInt16LE(offset + 28)
    const extraLen = buffer.readUInt16LE(offset + 30)
    const commentLen = buffer.readUInt16LE(offset + 32)
    const localOff = buffer.readUInt32LE(offset + 42)
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf8')
    offset += 46 + nameLen + extraLen + commentLen

    if (flags & 0x0001) throw new Error('encrypted zip unsupported')
    if (rawName.endsWith('/')) continue
    const path = rawName.replace(/\\/g, '/')
    if (!assertSafeRelPath(path)) throw new Error('unsafe zip path: ' + rawName)

    if (localOff + 30 > buffer.length || buffer.readUInt32LE(localOff) !== LOCAL_SIG) throw new Error('bad local header: ' + path)
    const start = localOff + 30 + buffer.readUInt16LE(localOff + 26) + buffer.readUInt16LE(localOff + 28)
    const end = start + compSize
    if (end > buffer.length) throw new Error('zip data out of bounds: ' + path)
    const comp = buffer.subarray(start, end)

    let content
    if (method === 0) content = Buffer.from(comp)
    else if (method === 8) content = inflateRawSync(comp, { maxOutputLength: MAX_FILE_BYTES + 1 })
    else throw new Error('zip method unsupported: ' + method)
    if (content.length > MAX_FILE_BYTES) throw new Error('zip file too large: ' + path)

    total += content.length
    if (total > MAX_TOTAL_BYTES) throw new Error('zip total too large')
    files.push({ path, buffer: content })
    if (files.length > MAX_FILES) throw new Error('too many zip entries')
  }
  return files
}

function stripCommonTopDir(files) {
  if (files.some((f) => f.path === SKILL_FILE)) return files
  const tops = new Set(files.map((f) => f.path.split('/')[0]))
  if (tops.size !== 1) return files
  const top = [...tops][0]
  return files.map((f) => ({ ...f, path: f.path.slice(top.length + 1) })).filter((f) => f.path !== '')
}

async function walkDir(dir, base = '') {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walkDir(p, base ? `${base}/${entry.name}` : entry.name))
    else out.push({ path: base ? `${base}/${entry.name}` : entry.name, buffer: await readFile(p) })
  }
  return out
}

export async function installFromSkillhub(skill, installRoot) {
  const s = skill.source || {}
  if (s.type !== 'skillhub' || !s.slug) throw new Error('unsupported skillhub source')
  const url = `https://api.skillhub.cn/api/v1/download?slug=${encodeURIComponent(s.slug)}`
  const zip = await fetchBuffer(url, 30000)

  let files
  try {
    files = stripCommonTopDir(extractZip(zip))
  } catch {
    const work = join(tmpdir(), `fcp-zip-${Date.now()}-${randomBytes(4).toString('hex')}`)
    const zipPath = join(work, 'skill.zip')
    const outDir = join(work, 'out')
    await mkdir(outDir, { recursive: true })
    await writeFile(zipPath, zip)
    if (process.platform === 'win32') {
      await execAsync('powershell', ['-NoProfile', '-Command',
        `Expand-Archive -Force -LiteralPath '${zipPath}' -DestinationPath '${outDir}'`])
    } else {
      await execAsync('unzip', ['-q', '-o', zipPath, '-d', outDir])
    }
    files = stripCommonTopDir(await walkDir(outDir))
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }

  return commitInstall({
    id: skill.id,
    files,
    provenance: {
      version: skill.version || '',
      license: skill.license || '',
      summary: (skill.summary && (skill.summary.zh || skill.summary.en)) || skill.summary || '',
      sourceType: 'skillhub', sourceSlug: s.slug, sourceNamespace: s.namespace || '',
      skillhubCommand: (skill.install && skill.install.skillhub) || '',
    },
    installRoot,
  })
}

/* ---------- 卸载（只移不删） ---------- */

export async function uninstallSkill(id, installRoot) {
  if (!isValidSkillId(id)) throw new Error('invalid skill id')
  const root = resolve(installRoot)
  const dir = join(root, id)
  const flat = join(root, `${id}.md`)
  const isDir = await isDirectory(dir)
  const isFlat = !isDir && await isFile(flat)
  if (!isDir && !isFlat) throw new Error(`skill ${id} 未安装`)

  const trashRoot = join(root, TRASH_DIR)
  await mkdir(trashRoot, { recursive: true })
  const stamp = `${id}-${Date.now()}`
  let dest = join(trashRoot, stamp)
  for (let i = 1; await isDirectory(dest) || await isFile(dest); i += 1) dest = join(trashRoot, `${stamp}-${i}`)

  if (isDir) await rename(dir, dest)
  else {
    await mkdir(dest, { recursive: true })
    await rename(flat, join(dest, `${id}.md`))
  }
  return { id, trashedTo: dest }
}

/* ---------- 装完立即生效 ---------- */

export function getSkills(ctx) {
  try {
    if (!ctx) return undefined
    if (ctx.skills) return ctx.skills
    if (typeof ctx.get === 'function') {
      const viaGet = ctx.get('skills')
      if (viaGet) return viaGet
    }
    if (ctx.root && ctx.root.skills) return ctx.root.skills
  } catch { /* 服务未就绪 */ }
  return undefined
}

export async function notifyMutation(ctx, logger, paths = []) {
  const list = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p !== '') : []
  let invalidated = false
  try {
    const skills = getSkills(ctx)
    if (skills && typeof skills.invalidateCache === 'function') {
      skills.invalidateCache()
      invalidated = true
    } else {
      logger?.warn?.('[fcp] 技能注册表不可用（无 invalidateCache），新技能需等宿主重扫')
    }
  } catch (error) {
    logger?.warn?.('[fcp] invalidateCache 失败：' + (error?.message || error))
  }

  let announced = false
  try {
    if (ctx && typeof ctx.emit === 'function') {
      for (const path of list) {
        let target
        try { if (ctx.fs && typeof ctx.fs.resolve === 'function') target = await ctx.fs.resolve(path) } catch { /* 落到手工构造 */ }
        if (!target || typeof target !== 'object') target = { displayPath: path, targetKey: path }
        ctx.emit('fs/observed', target, { kind: 'present', version: String(Date.now()) }, { name: 'write' })
        announced = true
      }
    }
  } catch (error) {
    logger?.warn?.('[fcp] fs/observed 广播失败：' + (error?.message || error))
  }
  return { invalidated, announced }
}
