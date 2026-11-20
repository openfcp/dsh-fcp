import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdir, realpath, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { _internal } from '../lib/index.js'
import { EXPERTS, expertById, routeTask } from '../lib/experts.js'
import {
  parseFrontmatter, normalizeSkillFrontmatter, resolveDshHome,
  extractZip,
} from '../lib/skills.js'
import {
  tokenize, scoreMatch, buildChunks, createKnowledgeTool, normalizeSources,
  rewriteImaQueries, searchIma,
} from '../lib/kb.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const {
  hostnameOf, isLoopback, isAllowedHost, isSameOriginRequest,
  guard, safeDirectory, isValidSkillId, isValidSkillName, readJson,
} = _internal

function request(overrides = {}) {
  return {
    method: 'GET',
    url: '/api/fcp/state',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: 'localhost:5173' },
    ...overrides,
  }
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(key, value) { this.headers[key] = value },
    end(body) { this.body = body },
  }
}

test('Host 解析只接受本地回环主机名', () => {
  assert.equal(hostnameOf('localhost:5173'), 'localhost')
  assert.equal(hostnameOf('127.0.0.1:8080'), '127.0.0.1')
  assert.equal(hostnameOf('[::1]:3000'), '[::1]')
  assert.equal(hostnameOf('evil.com'), 'evil.com')
  assert.equal(hostnameOf(''), null)
  assert.equal(hostnameOf('not a host'), null)
})

test('isLoopback 只放行本机地址', () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(isLoopback({ socket: { remoteAddress: address } }), true)
  }
  for (const address of ['192.168.1.2', 'example.com', undefined, null]) {
    assert.equal(isLoopback({ socket: { remoteAddress: address } }), false)
  }
})

test('isAllowedHost 挡住 DNS rebinding 常用的外部 Host', () => {
  for (const host of ['localhost', 'localhost:5173', '127.0.0.1', '[::1]:1234']) {
    assert.equal(isAllowedHost(request({ headers: { host } })), true)
  }
  for (const host of ['evil.com', 'attacker.com:443', 'localhost.evil.com', undefined]) {
    assert.equal(isAllowedHost(request({ headers: host ? { host } : {} })), false)
  }
})

test('写请求必须带自定义头，并拒绝跨站 Origin / Sec-Fetch-Site', () => {
  assert.equal(isSameOriginRequest(request({ headers: {} })), false)
  assert.equal(isSameOriginRequest(request({ headers: { 'x-fcp-client': '1' } })), true)
  assert.equal(isSameOriginRequest(request({ headers: { 'x-fcp-client': '1', origin: 'https://evil.com' } })), false)
  assert.equal(isSameOriginRequest(request({ headers: { 'x-fcp-client': '1', origin: 'http://localhost:5173' } })), true)
  assert.equal(isSameOriginRequest(request({ headers: { 'x-fcp-client': '1', 'sec-fetch-site': 'cross-site' } })), false)
  assert.equal(isSameOriginRequest(request({ headers: { 'x-fcp-client': '1', 'sec-fetch-site': 'same-origin' } })), true)
})

test('guard 对读请求校验 Host，对写请求额外要求同源', () => {
  assert.equal(guard(request(), response()), true)

  const remote = response()
  assert.equal(guard(request({ socket: { remoteAddress: '8.8.8.8' } }), remote), false)
  assert.equal(remote.statusCode, 403)

  const badHost = response()
  assert.equal(guard(request({ headers: { host: 'evil.com' } }), badHost), false)
  assert.equal(badHost.statusCode, 403)

  const csrf = response()
  const post = request({ method: 'POST', headers: {} })
  assert.equal(guard(post, csrf), false)
  assert.equal(csrf.statusCode, 403)

  const allowed = response()
  assert.equal(guard(request({ method: 'POST', headers: { host: 'localhost:5173', 'x-fcp-client': '1' } }), allowed), true)
})

test('fs-list 的目标只能落在 home 目录内', async () => {
  const home = await realpath(homedir())
  assert.equal(await safeDirectory('.', home), home)
  const scratchName = '.dsh-fcp-test-' + process.pid
  const scratch = join(home, scratchName)
  await mkdir(scratch, { recursive: true })
  try {
    assert.equal(await safeDirectory(scratchName, home), await realpath(scratch))
    assert.equal(await safeDirectory(scratch, home), await realpath(scratch))
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
  assert.equal(await safeDirectory('/etc', home), null)
  assert.equal(await safeDirectory('../../etc', home), null)
  assert.equal(await safeDirectory('/Applications', home), null)
})

test('技能 id 与名称有白名单字符集和长度上限', () => {
  assert.equal(isValidSkillId('policy-research'), true)
  assert.equal(isValidSkillId('a.b_c-9'), true)
  assert.equal(isValidSkillId(''), false)
  assert.equal(isValidSkillId('a/b'), false)
  assert.equal(isValidSkillId('__proto__'), false)
  assert.equal(isValidSkillId('x'.repeat(81)), false)
  assert.equal(isValidSkillName('消保审查'), true)
  assert.equal(isValidSkillName(''), false)
  assert.equal(isValidSkillName('a'.repeat(121)), false)
  assert.equal(isValidSkillName('bad\u0000name'), false)
})

test('readJson 要求 application/json 并能解析合法请求体', async () => {
  assert.throws(() => readJson({ headers: { 'content-type': 'text/plain' } }), /content-type/)
  const stream = Readable.from([Buffer.from(JSON.stringify({ id: 'policy-research' }))])
  stream.headers = { 'content-type': 'application/json; charset=utf-8' }
  assert.deepEqual(await readJson(stream), { id: 'policy-research' })
})

test('六位专家可解析，路由有关键词命中与兜底', () => {
  assert.equal(EXPERTS.length, 6)
  for (const expert of EXPERTS) assert.equal(expertById(expert.id), expert)
  assert.equal(routeTask('这单投诉已经超期，需要答复口径').expertId, 'complaint')
  assert.equal(routeTask('检查销售适当性和双录').expertId, 'sales')
  assert.equal(routeTask('随便聊点别的').expertId, 'general')
})

test('包元数据与发布版本一致且声明了 dsh.bundle', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'dsh-fcp')
  assert.equal(pkg.version, '2.1.0')
  assert.equal(pkg.author.name, '八大权益')
  assert.ok(pkg.dsh?.bundle?.patch)
  assert.equal(pkg.license, 'SEE LICENSE IN LICENSE')
  const readme = readFileSync(join(root, 'README.md'), 'utf8')
  assert.match(readme, /2\.0\.0/)
})

test('技能 frontmatter 解析与归一化（宿主只认 kebab-case 调用名）', () => {
  const fm = parseFrontmatter('---\nname: ppt-master\ndescription: 生成演示文稿\n---\n# Skill')
  assert.equal(fm.name, 'ppt-master')
  assert.equal(fm.description, '生成演示文稿')

  const bad = normalizeSkillFrontmatter('---\nname: PPT Master\n---\n正文', 'ai-ppt-skill', '演示文稿')
  assert.equal(bad.invocationName, 'ai-ppt-skill')
  assert.match(bad.content, /name: ai-ppt-skill/)
  assert.match(bad.content, /description: 演示文稿/)

  const missing = normalizeSkillFrontmatter('# 无 frontmatter', 'my-skill', '说明')
  assert.equal(missing.invocationName, 'my-skill')
  assert.match(missing.content, /^---\nname: my-skill/)
})

test('DSH_HOME 解析遵循显式值 > 环境变量 > ~/.dsh', () => {
  assert.equal(resolveDshHome('/custom/dsh'), resolve('/custom/dsh'))
  assert.equal(resolveDshHome(''), join(homedir(), '.dsh'))
  assert.equal(isValidSkillId('consumer-protection-review'), true)
  assert.equal(isValidSkillId('../evil'), false)
})

test('zip 解压对无效数据明确报错', () => {
  assert.throws(() => extractZip(Buffer.from('not a zip')), /EOCD/)
  assert.throws(() => extractZip(Buffer.alloc(40)), /EOCD/)
})

test('许可证为个人非商业使用协议且含联系邮箱', () => {
  const license = readFileSync(join(root, 'LICENSE'), 'utf8')
  assert.match(license, /非商业|非商用/)
  assert.match(license, /仅供个人/)
  assert.match(license, /support@openfcp\.com/)
})

test('知识检索分词：中文按二字切片、英文按词', () => {
  const tokens = tokenize('金融消费者权益保护 GDPR compliance')
  assert.ok(tokens.includes('金融'))
  assert.ok(tokens.includes('消费者权益'.slice(0, 2)))
  assert.ok(tokens.includes('gdpr'))
  assert.ok(tokens.includes('compliance'))
  assert.ok(scoreMatch('消费者权益', '保护金融消费者权益') > 0)
  assert.equal(scoreMatch('消费者权益', '无关内容'), 0)
})

test('Markdown 长文按段落切块且保留内容', () => {
  const text = Array.from({ length: 40 }, (_, i) => '第' + i + '条 相关规定内容。').join('\n\n')
  const chunks = buildChunks(text, 200)
  assert.ok(chunks.length >= 2)
  assert.match(chunks[0], /相关规定/)
})

test('知识检索工具定义符合 ctx.tools.register 契约', () => {
  const tool = createKnowledgeTool('/tmp/fcp-kb-test-home')
  assert.equal(tool.name, 'fcp_search_knowledge')
  assert.equal(tool.parameters.type, 'object')
  assert.deepEqual(tool.parameters.required, ['query'])
  assert.ok(tool.output.schema.type === 'object')
  assert.ok(typeof tool.output.render === 'function')
  const rendered = tool.output.render({ query: 'x' }, { found: false, sources: [], guidance: '未检索到' })
  assert.equal(rendered[0].type, 'text')
  assert.match(rendered[0].text, /未检索到/)
})

test('IMA 长句按精确匹配特性拆成可命中的短词', () => {
  const queries = rewriteImaQueries('适当性管理 投资者适当性 发展脉络 监管规定')
  assert.ok(queries.includes('适当性管理 投资者适当性 发展脉络 监管规定'))
  assert.ok(queries.includes('适当性管理'))
  assert.ok(queries.includes('投资者适当性'))
  assert.ok(queries.includes('适当性'))
})

test('IMA 检索不再因内部变量未定义而静默失败，且长句能降级命中', async () => {
  const originalFetch = globalThis.fetch
  const seen = []
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    seen.push(body.query)
    // 模拟 IMA 精确匹配：只有短词「适当性管理」能命中
    const list = body.query === '适当性管理'
      ? [{ title: '保险公司适当性管理监管政策梳理', highlight_content: '适当性管理要求' }]
      : []
    return { ok: true, status: 200, json: async () => ({ code: 0, data: { info_list: list } }) }
  }
  try {
    const ima = { apiKey: 'k', clientId: 'c', selectedKbs: ['kb1'], kbs: [{ id: 'kb1', name: '核心文件' }] }
    const result = await searchIma(ima, '适当性管理 投资者适当性 发展脉络 监管规定')
    assert.ok(result.length > 0, '长句应降级命中短词结果')
    assert.equal(result[0].title, '保险公司适当性管理监管政策梳理 · 核心文件')
    assert.ok(seen.includes('适当性管理'))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('知识检索返回值严格符合 output schema，不泄漏内部 score 字段', () => {
  const tool = createKnowledgeTool('/tmp/fcp-kb-test-home')
  const itemSchema = tool.output.schema.properties.sources.items
  const declared = Object.keys(itemSchema.properties)
  const normalized = normalizeSources([
    { source: 'IMA 知识库', title: '办法', excerpt: '条款', score: 10, internal: 'secret' },
  ])
  assert.equal(normalized.length, 1)
  assert.deepEqual(normalized[0], { source: 'IMA 知识库', title: '办法', excerpt: '条款' })
  // 回归关键：归一化后的每个字段都必须在 schema 中声明，且 schema 为 additionalProperties:false
  assert.equal(itemSchema.additionalProperties, false)
  for (const key of Object.keys(normalized[0])) {
    assert.ok(declared.includes(key), 'schema 未声明字段: ' + key)
  }
  assert.ok(declared.includes('score'), 'score 应在 schema 中声明为可选字段')
  assert.ok(!itemSchema.required.includes('score'))
})

test('知识配置读写落在临时 DSH_HOME 并归一化', async () => {
  const scratch = join(homedir(), '.dsh-fcp-kbtest-' + process.pid)
  await mkdir(scratch, { recursive: true })
  try {
    const { writeKbConfig, readKbConfig } = _internal
    await writeKbConfig(scratch, {
      ima: { apiKey: 'k', clientId: 'c', configured: true, selectedKbs: ['b1'], kbs: [{ id: 'b1', name: '国家法律知识库' }] },
      obsidian: { vault: '/tmp/vault', configured: true },
    })
    const config = await readKbConfig(scratch)
    assert.equal(config.ima.apiKey, 'k')
    assert.deepEqual(config.ima.selectedKbs, ['b1'])
    assert.equal(config.ima.kbs[0].name, '国家法律知识库')
    assert.equal(config.obsidian.vault, '/tmp/vault')
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})

test('上传 Markdown 后可被本地检索命中，删除后不再命中', async () => {
  const scratch = join(homedir(), '.dsh-fcp-kbup-' + process.pid)
  await mkdir(scratch, { recursive: true })
  try {
    const { addUploadedFile, removeUploadedFile, listUploaded, retrieveKnowledge } = _internal
    const added = await addUploadedFile(scratch, { name: '投诉时限规范.md', text: '投诉应在十五日内答复，金融消费者权益保护实施办法有明确规定。' })
    assert.ok(added.id.startsWith('kb-'))
    assert.ok(added.chunks > 0)
    assert.equal((await listUploaded(scratch)).length, 1)
    // 无 IMA/Obsidian 配置时，降级到上传知识库仍可命中
    const found = await retrieveKnowledge(scratch, '十五日答复')
    assert.equal(found.found, true)
    assert.ok(found.sources.some((s) => s.source === '上传知识库'))
    // 实测返回也不得带 score（此前导致工具 schema 校验失败）
    for (const source of found.sources) {
      assert.equal('score' in source, false)
    }
    await removeUploadedFile(scratch, added.id)
    assert.equal((await listUploaded(scratch)).length, 0)
    const missing = await retrieveKnowledge(scratch, '十五日答复')
    assert.equal(missing.found, false)
    assert.match(missing.guidance, /未检索到/)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})
