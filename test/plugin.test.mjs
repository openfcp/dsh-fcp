import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { _internal } from '../lib/index.js'
import { EXPERTS, expertById, routeTask } from '../lib/experts.js'

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
  assert.equal(await safeDirectory('Documents', home), resolve(home, 'Documents'))
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
  assert.equal(pkg.version, '1.0.1')
  assert.equal(pkg.author.name, '八大权益')
  assert.ok(pkg.dsh?.bundle?.patch)
  assert.equal(pkg.license, 'MIT')
  const readme = readFileSync(join(root, 'README.md'), 'utf8')
  assert.match(readme, /1\.0\.1/)
})
