;(function () {
  function show(message) {
    try {
      var el = document.createElement('div')
      el.setAttribute('data-fcp-error', '')
      el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99999;background:#b3261e;color:#fff;padding:8px 12px;border-radius:8px;font:12px/1.5 monospace;max-width:72vw;white-space:pre-wrap'
      el.textContent = 'dsh-fcp: ' + message
      document.body.appendChild(el)
    } catch (error) { /* ignore */ }
  }
  window.addEventListener('error', function (event) {
    var message = (event && event.message) || 'unknown error'
    if (String(message).indexOf('ResizeObserver') >= 0) return
    show(message)
  })
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason
    show('promise: ' + ((reason && reason.message) || String(reason)))
  })
})()

/**
 * dsh-fcp · 消保工作台 —— 浏览器半（手写 loader bundle，无构建步骤）
 * 布局：对齐 DSH 首页 HeroShell（垂直居中、stack 760），只多一行专家胶囊。
 */
window.__ModuleLoader__.load({
  id: 'dsh-fcp',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { useEffect, useMemo, useRef, useState } = React
    const h = React.createElement

    const PANEL_ID = 'fcp'
    const PANEL_LABEL = '消保工作台'
    // 平台检测：Windows 下 DSH 顶栏更高，右上角按钮需下移避开遮挡
    const IS_WINDOWS = typeof navigator !== 'undefined' && /win/i.test(navigator.platform || navigator.userAgent || '')
    const ROOT_CLASS = 'fcp-root' + (IS_WINDOWS ? ' fcp-win' : '')
    const API = {
      bind: 'api/fcp/bind',
      state: 'api/fcp/state',
      experts: 'api/fcp/experts',
      logo: 'api/fcp/logo',
      route: 'api/fcp/route',
      hero: 'api/fcp/hero',
      skillCatalog: 'api/fcp/skill-catalog',
      skillInstalled: 'api/fcp/skill-installed',
      skillDetail: 'api/fcp/skill-detail',
      skillInstall: 'api/fcp/skill-install',
      skillUninstall: 'api/fcp/skill-uninstall',
      imaKbs: 'api/fcp/ima-kbs',
      kbConfig: 'api/fcp/kb-config',
      kbUpload: 'api/fcp/kb-upload',
      kbList: 'api/fcp/kb-list',
      kbRemove: 'api/fcp/kb-remove',
      kbSearch: 'api/fcp/kb-search',
      fsList: 'api/fcp/fs-list',
      snip: 'api/fcp/snip',
      snipSave: 'api/fcp/snip-save',
    }
    // Host rejects cross-origin writes unless this header is present.
    const SEND_HEADERS = { 'content-type': 'application/json', 'x-fcp-client': '1' }
    const PENDING_KEY = 'dsh:plugin:fcp:pending'
    const PENDING_TTL = 10 * 60 * 1000
    const SETTINGS_KEY = 'dsh:plugin:fcp:settings'
    const CONFIG_KEY = 'dsh:plugin:fcp:config'
    const RECENT_FILES_KEY = 'dsh:plugin:fcp:recentFiles'

    const FALLBACK_EXPERTS = [
      { id: 'policy', name: '政策研究', summary: '监管新规跟踪、解读与影响面分析', skills: ['policy-research', 'lieflat-gongwen'] },
      { id: 'review', name: '消保审查', summary: '产品、营销、协议的事前合规审查', skills: ['consumer-protection-review', 'lieflat-gongwen'] },
      { id: 'complaint', name: '投诉管理', summary: '投诉分析、口径、时限与溯源整改', skills: ['complaint-management', 'lieflat-gongwen'] },
      { id: 'education', name: '金融教育', summary: '宣教策划、材料制作与效果评估', skills: ['financial-literacy-education', 'rayskills', 'lieflat-gongwen'] },
      { id: 'general', name: '综合管理', summary: '体制机制、检查、评价与考核', skills: ['consumer-protection-inspection', 'consumer-protection-annual-evaluation', 'lieflat-gongwen'] },
      { id: 'sales', name: '销售管理', summary: '适当性、双录与销售行为管理', skills: ['compliance-sales', 'lieflat-gongwen'] },
    ]

    const DEFAULT_CLOUD_MODELS = [
      { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash High', short: 'DeepSeek Flash', provider: 'DeepSeek', cloud: true, custom: false },
      { id: 'deepseek-v4', name: 'DeepSeek-V4.1', short: 'DeepSeek V4', provider: 'DeepSeek', cloud: true, custom: false },
      { id: 'deepseek-chat', name: 'DeepSeek-Chat', short: 'DeepSeek Chat', provider: 'DeepSeek', cloud: true, custom: false },
    ]

    /** 国内主流模型预设：厂商与基本字段自带，用户只需补 API 相关字段后保存。 */
    const MODEL_PRESETS = [
      { name: 'DeepSeek-V4.1-Flash High', provider: 'DeepSeek', id: 'deepseek-flash', cloud: true, baseUrl: 'https://api.deepseek.com/v1' },
      { name: 'DeepSeek-V4.1', provider: 'DeepSeek', id: 'deepseek-v4', cloud: true, baseUrl: 'https://api.deepseek.com/v1' },
      { name: 'DeepSeek-Chat', provider: 'DeepSeek', id: 'deepseek-chat', cloud: true, baseUrl: 'https://api.deepseek.com/v1' },
      { name: '通义千问 Max', provider: '阿里云', id: 'qwen-max', cloud: true, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      { name: '通义千问 Plus', provider: '阿里云', id: 'qwen-plus', cloud: true, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      { name: '豆包 Pro', provider: '火山引擎', id: 'doubao-pro', cloud: true, baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
      { name: '豆包 Lite', provider: '火山引擎', id: 'doubao-lite', cloud: true, baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
      { name: '智谱 GLM-4 Plus', provider: '智谱 AI', id: 'glm-4-plus', cloud: true, baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
      { name: 'Kimi', provider: '月之暗面', id: 'kimi', cloud: true, baseUrl: 'https://api.moonshot.cn/v1' },
      { name: 'MiniMax', provider: 'MiniMax', id: 'minimax', cloud: true, baseUrl: 'https://api.minimax.chat/v1' },
      { name: '混元', provider: '腾讯', id: 'hunyuan', cloud: true, baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1' },
    ]

    /** DSH 原生四种模式：标准 / PTC / 极简 / 创造（对齐右上角模式菜单）。 */
    const WORK_MODES = [
      { id: 'standard', name: '标准模式', desc: '处理代码、文件和资料，适合大多数任务。Agent 会按需使用检索、编辑和终端等工具。', preset: 'standard' },
      { id: 'ptc', name: 'PTC 模式', desc: '包含标准模式的所有能力，更适合批量调用工具，并对结果进行筛选、整理、去重、统计或汇总的任务。', preset: 'ptc' },
      { id: 'minimal', name: '极简模式', desc: 'Agent 使用终端和图片读取工具，并支持上下文压缩，适合测试和对比其基础表现。', preset: 'minimal' },
      { id: 'creative', name: '创造模式', desc: '用对话定制 DSH：让 Agent 编写插件，添加新功能或界面；也能组合工具和提示词，创建自己的模式。', preset: 'creative' },
    ]
    const MODE_KEY = 'dsh:plugin:fcp:mode'

    function readModels() {
      const saved = loadJson(MODELS_KEY, null)
      const custom = Array.isArray(saved) ? saved.filter((item) => item && item.custom === true) : []
      return DEFAULT_CLOUD_MODELS.concat(custom)
    }

    function modelFullName(item) {
      if (!item) return 'DeepSeek-V4.1-Flash High'
      return item.name || item.short || '自定义模型'
    }

    const MARKET_SKILLS = [
      ['official-source-qa', '官方口径问答', '检索监管原文并逐条溯源', 'github/openfcp'],
      ['law-skills', '法律咨询与起诉状', '法条查询 / 法律咨询', 'skillhub'],
      ['official-document-skill', '公文写作', '公文起草与校核', 'skillhub'],
      ['gongwenformat-pro', '公文排版 Pro', '国标格式 Word 排版', 'skillhub'],
      ['ai-ppt-skill', 'PPT Master', '智能生成可编辑 PPT', 'skillhub'],
      ['generate-chart', '智能数据可视化', 'Plotly 交互图表', 'skillhub'],
      ['smart-charts', '智能图表', 'ECharts 离线图表', 'skillhub'],
      ['aistockresearcher', '全球智能投研', '多资产量化分析', 'skillhub'],
      ['xiaoshuojubenzhuanfenjing', '分镜流水线', '小说到剧本分镜', 'skillhub'],
    ]

    const BUILTIN_THINKING = [
      ['SWOT', '战略/方案/竞争态势分析', 'v1'],
      ['5W2H', '任务澄清、方案落地', 'v1'],
      ['金字塔原理', '汇报、报告、公文', 'v1'],
      ['六顶思考帽', '会议、争议、多方视角', 'v1'],
      ['鱼骨图 / 5Why', '投诉归因、问题溯源', 'v1'],
      ['优先级矩阵', '整改排期、任务排序', 'v1'],
      ['PDCA', '整改闭环、活动复盘', 'v1'],
    ]

    const EXPERTS_CUSTOM_KEY = 'dsh:plugin:fcp:customExperts'
    const THINKING_KEY = 'dsh:plugin:fcp:thinking'
    const MODELS_KEY = 'dsh:plugin:fcp:models'
    const ACTIVE_MODEL_KEY = 'dsh:plugin:fcp:activeModel'
    const KB_FILES_KEY = 'dsh:plugin:fcp:kbFiles'

    async function readJsonResponse(response) {
      const text = await response.text()
      let data
      try { data = JSON.parse(text) } catch (error) {
        if (response.ok) throw new Error('返回内容不是有效的 JSON')
        throw new Error('接口未就绪（HTTP ' + response.status + '），请完全退出并重开 DSH')
      }
      if (!response.ok && data && data.error) throw new Error(String(data.error))
      return data
    }

    function loadJson(key, fallback) {
      try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value === null ? fallback : value } catch (error) { return fallback }
    }

    function saveJson(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)) } catch (error) { /* ignore */ }
    }

    // 把浏览器侧知识配置同步到 Host，供 fcp_search_knowledge 工具检索时读取。
    // 凭证只落本机 ~/.dsh/storages/fcp/，不上传任何远端。
    function syncKbConfig(config, kbs) {
      const payload = {
        ima: {
          apiKey: (config.ima && config.ima.apiKey) || '',
          clientId: (config.ima && config.ima.clientId) || '',
          configured: Boolean(config.ima && config.ima.configured),
          selectedKbs: loadJson('dsh:plugin:fcp:imaExtra', []),
          kbs: Array.isArray(kbs) ? kbs : loadJson('dsh:plugin:fcp:imaKbList', []),
        },
        obsidian: {
          vault: (config.obsidian && config.obsidian.vault) || '',
          configured: Boolean(config.obsidian && config.obsidian.configured),
        },
      }
      fetch(API.kbConfig, { method: 'POST', headers: SEND_HEADERS, body: JSON.stringify(payload) }).catch(() => {})
    }

    const SKILLS = [
      ['policy-research', '政策研究', '政策法规解读', 'openfcp/fcp-policy-research'],
      ['consumer-protection-review', '消保审查', '六维审查 / 八项权益 / 风险定级', 'openfcp/consumer-protection-review'],
      ['complaint-management', '投诉管理', '数据分析和解 / 整改 / 月报', 'openfcp/complaint-management'],
      ['financial-literacy-education', '金融宣教', '宣教全流程 / 效果评估', 'openfcp/financial-literacy-education'],
      ['rayskills', 'Ray 内容技能包', '长文/口播/科普/封面（9 子技能）', 'imraywang/rayskills'],
      ['consumer-protection-inspection', '消保检查', '检查计划 / 六大领域 / 整改', 'openfcp/consumer-protection-inspection'],
      ['consumer-protection-annual-evaluation', '消保评价', '自评 / 指标 / 失分诊断', 'openfcp/consumer-protection-annual-evaluation'],
      ['compliance-sales', '合规销售', '八不得 / 双录 / 适当性 / 渠道', 'openfcp/compliance-sales'],
      ['lieflat-gongwen', '公文写作', '规范公文格式（公共技能）', 'larashero3-dotcom/lieflat-gongwen'],
    ]

    const THINKING = [
      ['SWOT', 'v1', '战略/方案/竞争态势分析'],
      ['5W2H', 'v1', '任务澄清、方案落地'],
      ['金字塔原理', 'v1', '汇报、报告、公文'],
      ['六顶思考帽', 'v1', '会议、争议、多方视角'],
      ['鱼骨图 / 5Why', 'v1', '投诉归因、问题溯源'],
      ['优先级矩阵', 'v1', '整改排期、任务排序'],
      ['PDCA', 'v1', '整改闭环、活动复盘'],
      ['监管评价七要素拆解', 'v1', '自评、迎检'],
    ]

    const I = {
      plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
      scissors: 'M9.64 7.64c.23-.5.36-1.05.36-1.64 0-2.21-1.79-4-4-4S2 3.79 2 6s1.79 4 4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36C7.14 14.13 6.59 14 6 14c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4c0-.59-.13-1.14-.36-1.64L12 14l7 7h3v-1L9.64 7.64zM6 8c-1.1 0-2-.89-2-2s.9-2 2-2 2 .89 2 2-.9 2-2 2zm0 12c-1.1 0-2-.89-2-2s.9-2 2-2 2 .89 2 2-.9 2-2 2zm6-7.5c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5zM19 3l-6 6 2 2 7-7V3z',
      mic: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11z',
      arrow: 'M11 20V7.83L5.41 13.4 4 12l8-8 8 8-1.41 1.41L13 7.83V20z',
      folder: 'M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z',
      chevron: 'M7 10l5 5 5-5z',
      cloud: 'M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z',
      gem: 'M6 2h12l4 7-10 16L2 9zM9 4l-2 3h10l-2-3zM5.2 9l4.3 9-2.2-9zM18.8 9l-2.1 9 4.3-9z',
      settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.94 4c0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.03-1.58c.05-.3.07-.62.07-.94zM12 17.6A5.6 5.6 0 1 1 12 6.4a5.6 5.6 0 0 1 0 11.2z',
    }

    function Icon({ d, size = 20, viewBox = '0 0 24 24' }) {
      return h('svg', { width: size, height: size, viewBox, fill: 'currentColor', 'aria-hidden': 'true' }, h('path', { d }))
    }

    const BOARD_PATH = 'M2 4.5A2.5 2.5 0 0 1 4.5 2h7A2.5 2.5 0 0 1 14 4.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 11.5zM4.5 3A1.5 1.5 0 0 0 3 4.5V5h4.5V3zm4 0v7H13V4.5A1.5 1.5 0 0 0 11.5 3zm4.5 8H8.5v2h3a1.5 1.5 0 0 0 1.5-1.5zm-5.5 2V6H3v5.5A1.5 1.5 0 0 0 4.5 13z'
    class Boundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null } }
      static getDerivedStateFromError(error) { return { error } }
      render() {
        if (this.state.error) {
          return h('div', { style: { padding: 24, fontSize: 13, color: '#b3261e', whiteSpace: 'pre-wrap' } },
            '消保工作台渲染出错：' + String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error))
        }
        return this.props.children
      }
    }

    function PanelIcon({ size = 16 }) {
      return Icon({ d: BOARD_PATH, size, viewBox: '0 0 16 16' })
    }

    const CSS = `
.fcp-root,.fcp-settings,.fcp-page,.fcp-picker{--fcp-bg:var(--dsw-alias-bg-primary,#ffffff);--fcp-text:var(--dsw-alias-label-primary,#111111);--fcp-text2:var(--dsw-alias-label-secondary,#555555);--fcp-text3:var(--dsw-alias-label-caption,#888888);--fcp-border:var(--dsw-alias-border-l4,#e5e5e5);--fcp-hover:var(--dsw-alias-interactive-bg-hover,#f5f5f5);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
.fcp-root{position:relative;flex:1 1 auto;min-height:100vh;width:100%;--fcp-bg:var(--dsw-alias-bg-primary,#ffffff);--fcp-text:var(--dsw-alias-label-primary,#111111);--fcp-text2:var(--dsw-alias-label-secondary,#555555);--fcp-text3:var(--dsw-alias-label-caption,#888888);--fcp-border:var(--dsw-alias-border-l4,#e5e5e5);--fcp-hover:var(--dsw-alias-interactive-bg-hover,#f5f5f5);
  overflow:auto;background:var(--fcp-bg);color:var(--fcp-text);display:flex;justify-content:center;align-items:center;padding:102px 24px 48px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Segoe UI","Microsoft YaHei",sans-serif}
.fcp-stack{width:100%;max-width:760px;margin:0 auto}
.fcp-headline{display:flex;align-items:center;justify-content:center;gap:10px}
.fcp-headline img{width:34px;height:34px;border-radius:50%;flex:none;display:block}
.fcp-title{font-size:26px;font-weight:500;line-height:32px;color:var(--fcp-text);white-space:nowrap}
.fcp-title-wrap{position:relative;display:inline-flex;align-items:center}
.fcp-badge{position:absolute;top:-10px;left:100%;margin-left:6px;background:#02178E;color:#fff;border-radius:6px;padding:2px 7px;font-size:11px;line-height:16px;white-space:nowrap;font-weight:500}
.fcp-slogan{margin-top:14px;text-align:center;font-size:14px;line-height:22px;color:var(--fcp-text2)}
.fcp-caps{margin-top:132px;display:flex;flex-wrap:wrap;justify-content:center;gap:8px}
.fcp-cap{height:38px;padding:0 17px;border-radius:999px;border:1px solid var(--fcp-border);background:transparent;color:var(--fcp-text2);font-size:13px;font-weight:500;line-height:36px;cursor:pointer;font-family:inherit}
.fcp-cap:hover{background:var(--fcp-hover)}
.fcp-cap[aria-pressed="true"]{background:#333333;color:#ffffff;border-color:#333333}
.fcp-composer{margin:24px auto 0;max-width:722px;width:100%;border:1px solid var(--fcp-border);border-radius:24px;background:var(--fcp-bg);box-shadow:0 1px 6px rgba(0,0,0,.08);padding:12px 16px 10px;box-sizing:border-box}
.fcp-input{width:100%;border:0;outline:0;background:transparent;color:var(--fcp-text);font-size:15px;line-height:24px;font-family:inherit;resize:none;min-height:43px;height:43px;max-height:160px;display:block}
.fcp-input::placeholder{color:var(--fcp-text3)}
.fcp-tools{display:flex;align-items:center;gap:6px;margin-top:4px;min-height:30px}
.fcp-iconbtn{width:30px;height:30px;border-radius:999px;display:grid;place-items:center;color:var(--fcp-text2);background:transparent;border:0;cursor:pointer}
.fcp-iconbtn:hover{background:var(--fcp-hover)}
.fcp-plus{background:var(--fcp-hover);border-radius:50%}
/* 模式选择器：剪刀右侧，胶囊下拉，对齐 DSH 原生模式菜单 */
.fcp-mode{height:26px;display:inline-flex;align-items:center;gap:5px;padding:0 8px;border:0;border-radius:999px;background:transparent;color:var(--fcp-text3);font-size:12px;line-height:1;font-weight:400;cursor:pointer;font-family:inherit;white-space:nowrap;opacity:.85}
.fcp-mode:hover{background:var(--fcp-hover);opacity:1}
.fcp-mode svg{flex:none;color:var(--fcp-text3)}
.fcp-mode-menu{position:absolute;bottom:34px;left:0;width:min(420px,86vw);background:var(--fcp-bg);border:1px solid var(--fcp-border);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.16);padding:8px;z-index:40;box-sizing:border-box}
.fcp-mode-item{display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:10px 12px;border-radius:10px;cursor:pointer;font-family:inherit;position:relative}
.fcp-mode-item:hover{background:var(--fcp-hover)}
.fcp-mode-item b{display:block;font-size:13.5px;font-weight:600;margin-bottom:3px;padding-right:22px}
.fcp-mode-item span{display:block;font-size:12px;line-height:1.55;color:var(--fcp-text3);padding-right:22px}
.fcp-mode-item .check{position:absolute;right:12px;top:12px;color:var(--fcp-text);font-size:15px}
.fcp-model{margin-left:auto;display:flex;align-items:center;gap:4px;font-size:12.5px;color:var(--fcp-text2);height:34px;padding:0 8px;border-radius:8px;border:0;background:transparent;cursor:pointer;font-family:inherit;white-space:nowrap;max-width:300px;overflow:hidden;text-overflow:ellipsis}
.fcp-model:hover{background:var(--fcp-hover)}
.fcp-send{width:30px;height:30px;border-radius:50%;background:#0B57D0;color:#fff;display:grid;place-items:center;border:0;cursor:pointer;flex:none}
.fcp-send:disabled{background:#A8C7FA;color:#fff;opacity:1;cursor:default}
.fcp-meta{margin-top:16px;text-align:center;font-size:12px;line-height:20px;color:var(--fcp-text3)}
.fcp-meta a{color:inherit;text-decoration:underline;cursor:pointer}
.fcp-modal{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:24px;z-index:60}
.fcp-panel{width:min(760px,100%);max-height:min(640px,90vh);overflow:auto;background:var(--fcp-bg);color:var(--fcp-text);border-radius:16px;border:1px solid var(--fcp-border);box-shadow:0 8px 32px rgba(0,0,0,.18);padding:20px 22px;box-sizing:border-box}
.fcp-panel h2{margin:0 0 14px;font-size:18px;font-weight:600}
.fcp-tabs{display:flex;gap:6px;border-bottom:1px solid var(--fcp-border);margin-bottom:16px}
.fcp-tab{height:36px;padding:0 12px;border:0;background:transparent;color:var(--fcp-text2);font-size:13px;cursor:pointer;border-bottom:2px solid transparent;font-family:inherit}
.fcp-tab[aria-selected="true"]{color:var(--fcp-text);border-bottom-color:var(--fcp-text);font-weight:600}
.fcp-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--fcp-border)}
.fcp-row:last-child{border-bottom:0}
.fcp-row b{font-size:14px;font-weight:500}
.fcp-row span{font-size:12px;color:var(--fcp-text3)}
.fcp-row .grow{flex:1;min-width:0}
.fcp-chip{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--fcp-border);color:var(--fcp-text2);white-space:nowrap}
.fcp-dock{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;border:1px solid var(--fcp-border);background:var(--fcp-bg);color:var(--fcp-text2);font-size:12px;font-family:inherit;cursor:pointer}
.fcp-dock:hover{background:var(--fcp-hover)}
.fcp-dock-back{white-space:nowrap}
.fcp-dot{width:6px;height:6px;border-radius:50%;background:var(--fcp-text);flex:none}
/* 右上角三按钮：无胶囊边框，相对 root 安全区定位；macOS / Windows 都不被标题栏裁掉 */
.fcp-corner{position:absolute;top:12px;right:16px;display:flex;gap:2px;z-index:50;padding:0;background:transparent;border:0}
.fcp-corner .fcp-iconbtn{width:32px;height:32px;color:var(--fcp-text2)}
.fcp-corner .fcp-iconbtn:hover{background:var(--fcp-hover)}
/* Windows：DSH 顶栏更高，按钮下移到安全区，避免被标题栏遮挡 */
.fcp-win .fcp-corner{top:56px;right:14px}
/* 窄屏兜底：无论如何都保留在内容区可视范围内 */
@media (max-width:720px){.fcp-corner{top:10px;right:10px}.fcp-win .fcp-corner{top:52px;right:8px}}
.fcp-pop{position:absolute;bottom:44px;left:0;min-width:188px;background:var(--fcp-bg);border:1px solid var(--fcp-border);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.14);padding:6px;z-index:20}
.fcp-pop button{display:block;width:100%;text-align:left;padding:8px 10px;border:0;background:transparent;color:inherit;font-size:13px;border-radius:8px;cursor:pointer;font-family:inherit}
.fcp-pop button:hover{background:var(--fcp-hover)}
.fcp-pop button:disabled{color:var(--fcp-text3);cursor:default}
.fcp-ws{display:inline-flex;align-items:center;gap:4px;height:32px;padding:0 8px;border:0;background:transparent;color:var(--fcp-text2);font-size:12px;border-radius:8px;cursor:pointer;font-family:inherit}
.fcp-ws:hover{background:var(--fcp-hover)}
.fcp-file{display:inline-block;font-size:12px;color:var(--fcp-text2);background:var(--fcp-hover);border-radius:6px;padding:2px 8px;margin-top:6px}
.fcp-brand{width:34px;height:34px;display:grid;place-items:center;border:0;background:transparent;border-radius:10px;cursor:pointer;color:var(--fcp-text3)}
.fcp-brand:hover{background:var(--fcp-hover)}
.fcp-choices{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.fcp-pick-chip{display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:2px 8px;border-radius:6px;background:var(--fcp-hover);color:var(--fcp-text2)}
.fcp-pick-chip button{border:0;background:transparent;color:inherit;cursor:pointer;font-size:12px;padding:0;line-height:1}
.fcp-picker{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:24px;z-index:80}
.fcp-picker-panel{width:min(560px,100%);max-height:min(620px,88vh);overflow:auto;background:var(--fcp-bg);color:var(--fcp-text);border:1px solid var(--fcp-border);border-radius:16px;padding:16px;box-sizing:border-box;display:flex;flex-direction:column}
.fcp-picker-h{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.fcp-picker-h b{flex:1;font-size:15px;font-weight:600}
.fcp-pick-count{font-size:12px;color:var(--fcp-text3)}
.fcp-search{height:38px;border:1px solid var(--fcp-border);border-radius:10px;padding:0 12px;font-size:13px;background:transparent;color:inherit;outline:none;font-family:inherit;margin-bottom:10px}
.fcp-picker-list{flex:1;min-height:120px;max-height:360px;overflow:auto}
.fcp-picker-item{display:flex;flex-direction:column;gap:2px;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:8px 10px;border-radius:8px;cursor:pointer;font-family:inherit;position:relative}
.fcp-picker-item:hover{background:var(--fcp-hover)}
.fcp-picker-item.selected{background:var(--fcp-hover)}
.fcp-pick-name{font-size:13px;font-weight:500}
.fcp-pick-desc{font-size:12px;color:var(--fcp-text2)}
.fcp-pick-src{font-size:11px;color:var(--fcp-text3)}
.fcp-pick-ok{position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--fcp-text)}
.fcp-picker-f{display:flex;gap:8px;justify-content:flex-end;padding-top:12px;border-top:1px solid var(--fcp-border);margin-top:10px}
.fcp-btn{height:34px;padding:0 14px;border-radius:9px;border:1px solid var(--fcp-border);background:transparent;color:inherit;font-size:12px;cursor:pointer;font-family:inherit}
.fcp-btn.primary{background:#333;border-color:#333;color:#fff}
.fcp-empty{font-size:12px;color:var(--fcp-text3);padding:18px 10px;text-align:center}
.fcp-page{flex:1;min-height:100vh;overflow:auto;background:var(--fcp-bg);color:var(--fcp-text);padding:72px 24px 48px;box-sizing:border-box}
.fcp-page-inner{max-width:680px;margin:0 auto}
.fcp-back{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--fcp-text2);font-size:13px;cursor:pointer;padding:4px 0;font-family:inherit}
.fcp-page h2{font-size:22px;font-weight:600;margin:16px 0 4px}
.fcp-page .sub{font-size:13px;color:var(--fcp-text3);margin-bottom:22px}
.fcp-field{display:flex;flex-direction:column;gap:6px;margin:14px 0}
.fcp-field label{font-size:12px;color:var(--fcp-text2)}
.fcp-input2{height:40px;border:1px solid var(--fcp-border);border-radius:10px;padding:0 12px;font-size:13px;background:transparent;color:inherit;outline:none;font-family:inherit}
.fcp-card{border:1px solid var(--fcp-border);border-radius:12px;padding:12px 14px;margin:16px 0}
.fcp-card b{font-size:13px;font-weight:600}
.fcp-actions{display:flex;gap:8px;margin-top:18px}
.fcp-settings{display:block;flex:1;height:100vh;overflow-y:auto;background:var(--fcp-bg);color:var(--fcp-text);width:100%}
.fcp-nav{width:220px;flex:none;border-right:1px solid var(--fcp-border);padding:72px 12px 24px;box-sizing:border-box}
.fcp-nav button{display:block;width:100%;text-align:left;padding:9px 12px;border:0;border-radius:8px;background:transparent;color:var(--fcp-text2);font-size:13px;cursor:pointer;font-family:inherit;margin-bottom:2px}
.fcp-nav button:hover{background:var(--fcp-hover)}
.fcp-nav button[aria-selected="true"]{background:var(--fcp-hover);color:var(--fcp-text);font-weight:600}
.fcp-settings-main{max-width:1040px;margin:0 auto;padding:64px 40px 64px;box-sizing:border-box}
.fcp-settings-main h2{font-size:20px;font-weight:600;margin:0 0 4px}
.fcp-settings-main .sub{font-size:12px;color:var(--fcp-text3);margin-bottom:16px}
.fcp-expert-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-top:16px}
.fcp-expert-card{border:1px solid var(--fcp-border);border-radius:12px;padding:14px;position:relative;min-height:96px;box-sizing:border-box;background:var(--fcp-bg)}
.fcp-expert-card .check{position:absolute;right:12px;top:12px;font-size:12px}
.fcp-expert-card .type{font-size:11px;color:var(--fcp-text3);margin-top:8px}
.fcp-expert-card .del{position:absolute;right:10px;bottom:10px;border:0;background:transparent;color:var(--fcp-text3);font-size:11px;cursor:pointer;font-family:inherit}
.fcp-add-card{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;border:1px dashed var(--fcp-border);border-radius:12px;min-height:112px;cursor:pointer;color:var(--fcp-text3);background:transparent;font-size:12px;font-family:inherit}
.fcp-add-card:hover{background:var(--fcp-hover)}
.fcp-sec-title{font-size:13px;font-weight:600;margin:22px 0 8px}
.fcp-skill-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--fcp-border)}
.fcp-skill-row .grow{flex:1;min-width:0}
.fcp-skill-row b{font-size:13px;font-weight:500}
.fcp-skill-row span{display:block;font-size:11px;color:var(--fcp-text3);margin-top:2px}
.fcp-skill-row .tag{font-size:10px;padding:1px 6px;border:1px solid var(--fcp-border);border-radius:999px;color:var(--fcp-text3);white-space:nowrap}
.fcp-sk-fixed{display:inline-flex;align-items:center;height:34px;padding:0 4px;font-size:12px;line-height:1;color:var(--fcp-text3);white-space:nowrap}
.fcp-kb-card{border:1px solid var(--fcp-border);border-radius:12px;padding:16px;margin-bottom:14px}
.fcp-kb-card h3{font-size:14px;margin:0 0 4px}
.fcp-kb-card .hint{font-size:11px;color:var(--fcp-text3);margin-bottom:12px}
.fcp-check{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--fcp-text2);padding:4px 0}
.fcp-drawer{position:fixed;top:0;right:0;bottom:0;width:380px;max-width:92vw;background:var(--fcp-bg);border-left:1px solid var(--fcp-border);box-shadow:-8px 0 24px rgba(0,0,0,.12);z-index:90;display:flex;flex-direction:column;padding:16px;box-sizing:border-box}
.fcp-drawer-h{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.fcp-drawer-h b{flex:1;font-size:15px}
.fcp-settings-head{display:flex;align-items:center;gap:12px;margin-bottom:8px}

.fcp-sk-toolbar{display:flex;align-items:center;gap:10px;margin:14px 0 10px}
.fcp-sk-search{flex:1;height:38px;border:1px solid var(--fcp-border);border-radius:10px;padding:0 12px;font-size:13px;background:transparent;color:inherit;outline:none;font-family:inherit}
.fcp-seg{display:flex;border:1px solid var(--fcp-border);border-radius:10px;overflow:hidden}
.fcp-seg button{border:0;background:transparent;color:var(--fcp-text2);font-size:12px;padding:0 12px;height:36px;cursor:pointer;font-family:inherit}
.fcp-seg button[aria-pressed="true"]{background:var(--fcp-hover);color:var(--fcp-text);font-weight:600}
.fcp-sk-cats{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.fcp-sk-cat{border:1px solid var(--fcp-border);border-radius:999px;background:transparent;color:var(--fcp-text2);font-size:12px;padding:4px 12px;cursor:pointer;font-family:inherit}
.fcp-sk-cat[aria-pressed="true"]{background:var(--fcp-text);color:var(--fcp-bg);border-color:var(--fcp-text)}
.fcp-sk-row{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--fcp-border)}
.fcp-sk-icon{width:44px;height:44px;border-radius:10px;background:var(--fcp-hover);display:flex;align-items:center;justify-content:center;font-size:16px;flex:none}
.fcp-sk-main{flex:1;min-width:0}
.fcp-sk-name{font-size:14px;font-weight:500}
.fcp-sk-desc{font-size:12px;color:var(--fcp-text3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fcp-sk-meta{display:flex;gap:8px;font-size:11px;color:var(--fcp-text3);margin-top:3px}
.fcp-kb-sec{padding:18px 0;border-bottom:1px solid var(--fcp-border)}
.fcp-kb-sec:last-child{border-bottom:0}
.fcp-kb-sec h3{font-size:15px;margin:0 0 4px}
.fcp-thinking-card{border:1px solid var(--fcp-border);border-radius:12px;padding:16px;display:flex;align-items:center;gap:12px}
.fcp-thinking-card .grow{flex:1;min-width:0}
.fcp-model-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;margin-top:14px}
.fcp-model-card{border:1px solid var(--fcp-border);border-radius:12px;padding:14px;margin:0;background:var(--fcp-bg)}
.fcp-model-card.active{background:var(--fcp-hover)}
.fcp-model-head{display:flex;align-items:center;gap:10px}
.fcp-model-head .grow{flex:1;min-width:0}
.fcp-model-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
.fcp-model-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:10px;align-items:center}
.fcp-submenu{position:absolute;left:100%;bottom:0;margin-left:8px;width:320px;background:var(--fcp-bg);border:1px solid var(--fcp-border);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.14);padding:10px;z-index:30;box-sizing:border-box}
.fcp-submenu .fcp-search{margin-bottom:8px;height:34px}
.fcp-submenu-list{max-height:260px;overflow:auto}
.fcp-submenu-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:7px 8px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px}
.fcp-submenu-item:hover{background:var(--fcp-hover)}
.fcp-submenu-foot{display:flex;justify-content:flex-end;margin-top:8px;border-top:1px solid var(--fcp-border);padding-top:8px}
.fcp-settings-card{border:1px solid var(--fcp-border);border-radius:16px;background:var(--fcp-bg);padding:20px 24px 28px;margin-top:8px}
.fcp-picker .sub{font-size:12px;line-height:1.7;color:var(--fcp-text3)}
.fcp-detail-meta{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;line-height:1.7;color:var(--fcp-text3);padding:8px 11px;background:var(--fcp-hover);border-radius:9px}
.fcp-detail-summary{font-size:13px;line-height:1.75;color:var(--fcp-text2);margin:13px 0 0}
.fcp-detail-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}
.fcp-detail-tags span{font-size:11px;line-height:1.6;color:var(--fcp-text3);background:var(--fcp-hover);border-radius:999px;padding:2px 9px}
.fcp-detail-desc{font-size:12.5px;line-height:1.75;color:var(--fcp-text2);margin-top:13px;padding-top:12px;border-top:1px solid var(--fcp-border)}
.fcp-detail-pre{white-space:pre-wrap;font:12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;max-height:380px;overflow:auto;background:var(--fcp-hover);border-radius:10px;padding:12px;margin:10px 0 0}
.fcp-snip{position:relative;width:48px;height:48px;border-radius:8px;overflow:hidden;border:1px solid var(--fcp-border)}
.fcp-snip img{width:100%;height:100%;object-fit:cover;display:block}
.fcp-snip button{position:absolute;right:2px;top:2px;width:16px;height:16px;border-radius:50%;border:0;background:rgba(0,0,0,.6);color:#fff;font-size:11px;line-height:16px;padding:0;cursor:pointer}
.fcp-help-list{margin:8px 0 0;padding-left:20px;font-size:13px;line-height:1.95;color:var(--fcp-text2)}
.fcp-help-list li{margin:3px 0}
/* 技能页：对齐 dsh-financial-skills v0.2.3 的长条卡与胶囊风格 */
.fcp-sk-hero{display:flex;align-items:center;gap:14px;min-width:0;padding:18px 20px;border:.5px solid var(--fcp-border);border-radius:16px;background:var(--fcp-hover)}
.fcp-sk-hero img{width:42px;height:42px;border-radius:10px;flex:none}
.fcp-sk-hero-title{margin:0;font-size:18px;font-weight:600;line-height:24px}
.fcp-sk-hero-slogan{margin:2px 0 0;font-size:12.5px;line-height:18px;color:var(--fcp-text2)}
.fcp-sk-hero-badge{margin-left:auto;flex:none;padding:5px 12px;border:.5px solid var(--fcp-border);border-radius:999px;font-size:12.5px;color:var(--fcp-text2);white-space:nowrap}
.fcp-sk-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--fcp-text3);margin:12px 0 4px}
.fcp-sk-refresh{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 11px;border:1px solid color-mix(in srgb,#b3261e 45%,transparent);border-radius:999px;background:color-mix(in srgb,#b3261e 10%,transparent);color:#b3261e;font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}
.fcp-sk-refresh:hover{background:color-mix(in srgb,#b3261e 18%,transparent)}
.fcp-sk-refresh:disabled{cursor:progress;opacity:.6}
.fcp-sk-card{display:flex;align-items:center;gap:14px;min-width:0;padding:12px 14px;border:1px solid var(--fcp-border);border-radius:14px;background:var(--fcp-bg);transition:border-color .2s,background-color .2s}
.fcp-sk-card:hover{border-color:var(--fcp-text3);background:var(--fcp-hover)}
.fcp-sk-card[data-installed="true"]{border-color:#188038}
.fcp-sk-card-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
.fcp-sk-card-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;min-width:0}
.fcp-sk-card-name{border:0;background:0 0;padding:0;color:inherit;font:inherit;font-size:14px;font-weight:600;line-height:20px;cursor:pointer;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.fcp-sk-card-name:hover{text-decoration:underline;text-underline-offset:3px}
.fcp-sk-card-en{color:var(--fcp-text3);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fcp-sk-card-facts{margin-left:auto;flex:none;display:inline-flex;gap:12px;font-size:11px;color:var(--fcp-text3);white-space:nowrap}
.fcp-sk-card-summary{margin:0;font-size:12px;line-height:18px;color:var(--fcp-text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fcp-sk-card-chips{display:flex;flex-wrap:wrap;gap:6px}
.fcp-sk-card-invoke{font-size:11.5px;line-height:16px;color:#188038}
.fcp-sk-card-invoke code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.fcp-sk-card-actions{display:flex;flex:none;gap:6px}
.fcp-sk-grid{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}
.fcp-sk-pill{border:1px solid var(--fcp-border);border-radius:999px;background:transparent;color:var(--fcp-text2);font-size:12px;padding:4px 12px;cursor:pointer;font-family:inherit;white-space:nowrap}
.fcp-sk-pill[aria-pressed="true"]{background:var(--fcp-text);color:var(--fcp-bg);border-color:var(--fcp-text)}
.fcp-sk-pill-count{font-variant-numeric:tabular-nums;color:var(--fcp-text3);font-size:11px}
/* IMA 配置上下两部分：中间横线 */
.fcp-hr{height:0;margin:22px 0;border:0;border-top:1px solid var(--fcp-border)}
.fcp-kb-table{width:100%;max-height:300px;overflow:auto;border:1px solid var(--fcp-border);border-radius:10px;margin:10px 0}
.fcp-kb-table-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--fcp-border);font-size:12.5px;cursor:pointer}
.fcp-kb-table-row:last-child{border-bottom:0}
.fcp-kb-table-row:hover{background:var(--fcp-hover)}
.fcp-kb-table-row input{flex:none;accent-color:#0B57D0}
.fcp-kb-table-row .grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fcp-kb-table-row .kb-id{font-size:11px;color:var(--fcp-text3);flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 模型卡片：云朵图标放左下角 */
.fcp-model-card{position:relative;padding-bottom:34px}
.fcp-model-cloud{position:absolute;left:14px;bottom:10px;display:inline-flex;align-items:center;gap:4px;color:var(--fcp-text3);font-size:11px}
.fcp-model-cloud svg{color:var(--fcp-text3)}
.fcp-add-model-bar{display:flex;justify-content:flex-end;margin:6px 0 2px}
.fcp-model-preset{width:100%;height:38px;border:1px solid var(--fcp-border);border-radius:10px;padding:0 10px;background:transparent;color:inherit;font-size:13px;font-family:inherit;outline:none}
/* 头图：商务简约 */
.fcp-hero-img{display:block;width:100%;max-height:200px;object-fit:cover;border-radius:14px;margin-bottom:18px}
@media (max-width:720px){.fcp-root{padding:56px 16px 32px}.fcp-caps{margin-top:84px}.fcp-stack{max-width:100%}.fcp-sk-card-facts{display:none}.fcp-mode-menu{width:86vw}}
`

    function injectCss() {
      const id = 'dsh-fcp/panel.css'
      if (document.querySelector('style[data-plugin-css="' + id + '"]')) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-fcp'
      tag.dataset.pluginCss = id
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    function readPending() {
      try {
        const raw = localStorage.getItem(PENDING_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (parsed && parsed.expertId && Date.now() - Number(parsed.at || 0) < PENDING_TTL) return parsed
      } catch (error) { /* ignore */ }
      return null
    }

    function loadSettings() {
      try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') } catch (error) { return {} }
    }

    function loadConfig() {
      try {
        const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}')
        return {
          ima: { apiKey: saved.ima && saved.ima.apiKey || '', clientId: saved.ima && saved.ima.clientId || '', configured: saved.ima && saved.ima.configured === true },
          obsidian: { vault: saved.obsidian && saved.obsidian.vault || '', configured: saved.obsidian && saved.obsidian.configured === true },
        }
      } catch (error) {
        return { ima: { apiKey: '', clientId: '', configured: false }, obsidian: { vault: '', configured: false } }
      }
    }

    function readRecentFiles() {
      try { const saved = JSON.parse(localStorage.getItem(RECENT_FILES_KEY) || '[]'); return Array.isArray(saved) ? saved : [] } catch (error) { return [] }
    }

    function FcpPage({ ctx }) {
      const [view, setView] = useState('home')
      const [config, setConfig] = useState(loadConfig)
      const [experts, setExperts] = useState(FALLBACK_EXPERTS)
      const [selected, setSelected] = useState('')
      const [value, setValue] = useState('')
      const [model, setModel] = useState(() => {
        const id = loadJson(ACTIVE_MODEL_KEY, '')
        const list = readModels()
        const found = Array.isArray(list) ? list.find((item) => item.id === id) : undefined
        return modelFullName(found)
      })
      const [models, setModels] = useState(readModels)
      const [dshModels, setDshModels] = useState([])
      const [modelOpen, setModelOpen] = useState(false)
      const [modeId, setModeId] = useState(() => loadJson(MODE_KEY, 'standard'))
      const [modeOpen, setModeOpen] = useState(false)
      const [plusOpen, setPlusOpen] = useState(false)
      const [settingsTab, setSettingsTab] = useState('experts')
      const [picker, setPicker] = useState('')
      const [skillMenuOpen, setSkillMenuOpen] = useState(false)
      const [fileQuery, setFileQuery] = useState('')
      const [skillQuery, setSkillQuery] = useState('')
      const [selectedFiles, setSelectedFiles] = useState([])
      const [selectedSkills, setSelectedSkills] = useState([])
      const [extraSkills, setExtraSkills] = useState([])
      const [installedIds, setInstalledIds] = useState([])
      const [snips, setSnips] = useState([])
      const [snipBusy, setSnipBusy] = useState(false)
      const [routing, setRouting] = useState(false)
      const [error, setError] = useState('')
      const inputRef = useRef(null)
      const fileRef = useRef(null)
      const capsRef = useRef(null)
      const plusRef = useRef(null)
      const modelRef = useRef(null)
      const modeRef = useRef(null)

      useEffect(() => {
        let alive = true
        fetch(API.experts, { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => { if (alive && data && data.ok && Array.isArray(data.value)) setExperts(data.value) })
          .catch(() => {})
        return () => { alive = false }
      }, [])

      // 输入框模型与 DSH 保持一致：直接读取 DSH 的真实模型目录（remote.session.modelCatalog）
      useEffect(() => {
        let alive = true
        try {
          const remote = typeof ctx.get === 'function' ? ctx.get('remote') : undefined
          const ns = remote && remote.session
          if (ns && typeof ns.modelCatalog === 'function') {
            Promise.resolve(ns.modelCatalog()).then((response) => {
              if (!alive || !response || !response.ok || !response.value) return
              const groups = Array.isArray(response.value.groups) ? response.value.groups : []
              const list = []
              for (const group of groups) {
                for (const m of (Array.isArray(group.models) ? group.models : [])) {
                  list.push({ id: m.id, name: m.name || m.id, short: m.name || m.id, provider: group.name || group.id, cloud: true, custom: false })
                }
              }
              if (list.length > 0) setDshModels(list)
            }).catch(() => {})
          }
        } catch (error) { /* DSH 模型目录不可用时保留本地列表 */ }
        return () => { alive = false }
      }, [ctx])

      useEffect(() => {
        if (error === '') return undefined
        const timer = setTimeout(() => setError(''), 5000)
        return () => clearTimeout(timer)
      }, [error])

      // 已安装技能：挂载即读 + 安装/卸载后立即重读（storage / 自定义事件），跨插件共享目录也即时生效
      const syncInstalledSkills = () => {
        fetch(API.skillInstalled, { cache: 'no-store' })
          .then((response) => readJsonResponse(response))
          .then((data) => {
            if (!data || !data.ok || !data.value) return
            setExtraSkills(Object.values(data.value.names || {}).filter((name) => typeof name === 'string'))
            setInstalledIds(Array.isArray(data.value.installed) ? data.value.installed : [])
          })
          .catch(() => {})
      }
      useEffect(() => {
        syncInstalledSkills()
        const onSkillsChanged = () => syncInstalledSkills()
        const onStorage = (event) => { if (event.key && /skills|fcp/i.test(event.key)) syncInstalledSkills() }
        window.addEventListener('fcp:skills-changed', onSkillsChanged)
        window.addEventListener('financial-skills:changed', onSkillsChanged)
        window.addEventListener('storage', onStorage)
        const timer = setInterval(syncInstalledSkills, 15000)
        return () => {
          window.removeEventListener('fcp:skills-changed', onSkillsChanged)
          window.removeEventListener('financial-skills:changed', onSkillsChanged)
          window.removeEventListener('storage', onStorage)
          clearInterval(timer)
        }
      }, [])

      useEffect(() => {
        const el = inputRef.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = Math.max(43, Math.min(el.scrollHeight, 160)) + 'px'
      }, [value])

      useEffect(() => {
        if (!plusOpen && !modelOpen && !skillMenuOpen && !modeOpen) return undefined
        const onDown = (event) => {
          if (plusRef.current && !plusRef.current.contains(event.target)) { setPlusOpen(false); setSkillMenuOpen(false) }
          if (modelRef.current && !modelRef.current.contains(event.target)) setModelOpen(false)
          if (modeRef.current && !modeRef.current.contains(event.target)) setModeOpen(false)
        }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
      }, [plusOpen, modelOpen, skillMenuOpen, modeOpen])

      useEffect(() => { if (!plusOpen) setSkillMenuOpen(false) }, [plusOpen])



      // 下拉优先展示 DSH 真实模型；用户自建的 API 模型追加在后面（按 id 去重）
      const modelOptions = useMemo(() => {
        const base = dshModels.length > 0 ? dshModels : DEFAULT_CLOUD_MODELS
        const seen = new Set(base.map((item) => item.id))
        const custom = models.filter((item) => item.custom === true && !seen.has(item.id))
        return base.concat(custom)
      }, [dshModels, models])
      const current = selected === '' ? null : experts.find((item) => item.id === selected) || null
      const recentFiles = readRecentFiles()

      const persistConfig = (next) => {
        setConfig(next)
        try { localStorage.setItem(CONFIG_KEY, JSON.stringify(next)) } catch (error) { /* ignore */ }
      }

      const addFile = (name) => {
        if (typeof name !== 'string' || name === '') return
        setSelectedFiles((list) => list.includes(name) ? list : list.concat(name))
        const next = [name].concat(readRecentFiles().filter((item) => item !== name)).slice(0, 8)
        try { localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next)) } catch (error) { /* ignore */ }
      }

      const toggleSkill = (id) => {
        setSelectedSkills((list) => list.includes(id) ? list.filter((item) => item !== id) : list.concat(id))
      }

      const addSnip = (snip) => setSnips((list) => list.concat(snip))
      const browserSnip = async () => {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') throw new Error('当前环境不支持屏幕捕获')
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        try {
          const video = document.createElement('video')
          video.srcObject = stream
          await video.play()
          await new Promise((resolve) => setTimeout(resolve, 120))
          const canvas = document.createElement('canvas')
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          canvas.getContext('2d').drawImage(video, 0, 0)
          const dataUrl = canvas.toDataURL('image/png')
          const response = await fetch(API.snipSave, { method: 'POST', headers: SEND_HEADERS, body: JSON.stringify({ dataUrl }) })
          const data = await readJsonResponse(response)
          addSnip(data && data.ok ? data.value : { path: '', dataUrl })
        } finally {
          for (const track of stream.getTracks()) track.stop()
        }
      }
      const snip = () => {
        if (snipBusy) return
        setSnipBusy(true)
        fetch(API.snip, { method: 'POST', headers: SEND_HEADERS, body: '{}' })
          .then((response) => readJsonResponse(response))
          .then((data) => { if (!data || !data.ok) throw new Error(data && data.error ? data.error : '截图失败'); addSnip(data.value) })
          .catch(async (error) => {
            try { await browserSnip() } catch (fallbackError) { setError('截图失败：' + String((error && error.message) || error) + '；请在系统设置→隐私与安全性→屏幕录制中允许 DeepSeek Harness，或改用 Cmd+V 粘贴图片') }
          })
          .finally(() => setSnipBusy(false))
      }
      const onPaste = (event) => {
        const items = event.clipboardData && event.clipboardData.items
        if (!items) return
        for (const item of items) {
          if (item.type && item.type.indexOf('image/') === 0) {
            const file = item.getAsFile()
            if (!file) continue
            const reader = new FileReader()
            reader.onload = () => addSnip({ path: '', dataUrl: String(reader.result || '') })
            reader.readAsDataURL(file)
          }
        }
      }

      const submit = async () => {
        const text = value.trim()
        if (text === '' || routing) return
        const extras = []
        if (selectedFiles.length > 0) extras.push('附件：' + selectedFiles.join('、'))
        if (selectedSkills.length > 0) extras.push('技能：' + selectedSkills.join('、'))
        const snipPaths = snips.map((item) => item.path).filter((path) => typeof path === 'string' && path !== '')
        if (snipPaths.length > 0) extras.push('截图：' + snipPaths.join('、'))
        const full = extras.length > 0 ? text + '\n\n[工作台上下文] ' + extras.join('；') : text
        setRouting(true)
        let expertId = current ? current.id : ''
        if (expertId === '') {
          try {
            const response = await fetch(API.route, {
              method: 'POST', headers: SEND_HEADERS, body: JSON.stringify({ text }),
            })
            const data = await response.json()
            if (data && data.ok && data.value && data.value.expertId) expertId = data.value.expertId
          } catch (error) { /* fallback below */ }
        }
        if (expertId === '') expertId = 'general'
        try { localStorage.setItem(PENDING_KEY, JSON.stringify({ expertId, at: Date.now() })) } catch (error) { /* ignore */ }
        let nav, sessions, workspaces, conversation
        try {
          nav = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
          sessions = ctx.get('sessions')
          workspaces = ctx.get('workspaces')
          conversation = ctx.get('conversation')
        } catch (error) { nav = undefined }
        setRouting(false)
        if (!nav || typeof nav.startSession !== 'function') {
          setError('暂时无法打开会话，请确认当前在 DSH 桌面/网页会话中。')
          return
        }
        setError('')
        setValue('')
        setSelectedFiles([])
        setSelectedSkills([])
        setSnips([])

        // 工作模式作为轻量上下文注入（不使用宿主 preset，避免覆盖用户会话设置）
        const activeMode = WORK_MODES.find((m) => m.id === modeId) || WORK_MODES[0]
        const finalPrompt = modeId === 'standard' ? full : full + '\n\n[运行模式：' + activeMode.name + ']'

        // 目标 workspaceId：优先复用 startSession 的「当前/最近」规则
        const pickWorkspaceId = () => {
          try {
            const w = workspaces && workspaces.list && workspaces.list.getSnapshot()
            const s = sessions && sessions.list && sessions.list.getSnapshot()
            const items = (w && w.items) || []
            if (items.length === 0) return undefined
            const byId = (s && s.byId) || {}
            let selected, selectedTime = Number.NEGATIVE_INFINITY
            for (const item of items) {
              let latest = Number.NEGATIVE_INFINITY
              for (const id of (item.sessionIds || [])) {
                const session = byId[id]
                if (session && typeof session.updatedAt === 'number') latest = Math.max(latest, session.updatedAt)
              }
              if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(item.createdAt) || 0
              if (selected === undefined || latest > selectedTime) { selected = item.workspaceId; selectedTime = latest }
            }
            return selected
          } catch (error) { return undefined }
        }

        let sent = false
        const beforeOpen = (sessionId) => {
          try {
            const binding = sessions && typeof sessions.binding === 'function' ? sessions.binding(sessionId) : undefined
            const conv = binding && conversation ? conversation : undefined
            if (!binding || !conv || !conv.input) return
            const result = conv.input.requestDraftInitialization(binding, { prompt: finalPrompt, whenDraftExists: 'replace' })
            if (result === 'blocked') return
            conv.input.for(binding.ctx || (sessions.scope && sessions.scope(sessionId))).submit()
            sent = true
          } catch (error) { /* 回退到 startSession */ }
        }

        const target = pickWorkspaceId()
        if (target && typeof nav.openWorkspace === 'function') {
          try { await nav.openWorkspace(target, beforeOpen) } catch (error) { /* fallback */ }
        }
        if (!sent) {
          try { nav.startSession(undefined, { prompt: finalPrompt, whenDraftExists: 'replace' }) }
          catch (error) { setError('打开会话失败：' + String((error && error.message) || error)) }
        }
      }

      const onKeyDown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() }
      }

      if (view === 'ima') {
        return h(ImaPage, { config, onBack: () => setView('home'), onSaved: persistConfig })
      }
      if (view === 'obsidian') {
        return h(ObsidianPage, { config, onBack: () => setView('home'), onSaved: persistConfig })
      }
      if (view === 'settings') {
        return h(SettingsPage, { tab: settingsTab, onBack: () => setView('home'), config, onSaved: persistConfig, models, setModels, ctx, installedIds })
      }

      const filteredFiles = recentFiles.filter((name) => fileQuery === '' || name.toLowerCase().includes(fileQuery.toLowerCase()))
      const filteredSkills = SKILLS.filter((item) => {
        const text = (item[0] + ' ' + item[1] + ' ' + item[2]).toLowerCase()
        return skillQuery === '' || text.includes(skillQuery.toLowerCase())
      })

      return h('div', { className: ROOT_CLASS },
        h('div', { className: 'fcp-corner' },
          config.ima.configured ? h('button', { type: 'button', className: 'fcp-brand', title: 'IMA 知识库（已连接）', 'aria-label': 'IMA 知识库', onClick: () => { setSettingsTab('knowledge'); setView('settings') } }, h(ImaMark, { size: 22, active: true })) : null,
          config.obsidian.configured ? h('button', { type: 'button', className: 'fcp-brand', title: 'Obsidian（已连接）', 'aria-label': 'Obsidian', onClick: () => { setSettingsTab('knowledge'); setView('settings') } }, h(ObsidianMark, { size: 22, active: true })) : null,
          h('button', { type: 'button', className: 'fcp-brand', 'aria-label': '设置', title: '设置', onClick: () => { setSettingsTab('experts'); setView('settings') } }, h(GearMark, { size: 22 }))
        ),
        h('input', {
          ref: fileRef, type: 'file', style: { display: 'none' },
          onChange: (event) => { const picked = event.target.files && event.target.files[0]; if (picked) addFile(picked.name); event.target.value = '' },
        }),
        h('div', { className: 'fcp-stack' },
          h('div', { className: 'fcp-headline' },
            h('img', { src: API.logo, alt: '消保工作台' }),
            h('span', { className: 'fcp-title-wrap' },
              h('span', { className: 'fcp-title' }, '八大权益'),
              h('span', { className: 'fcp-badge' }, '消保工作台')
            )
          ),
          h('div', { className: 'fcp-slogan' }, '重塑消保工作模式，让每一份努力都被看见'),
          h('div', { ref: capsRef, className: 'fcp-caps', role: 'group', 'aria-label': '选择专家（可不选，系统自动调度）' },
            experts.map((expert) => h('button', {
              key: expert.id, type: 'button', className: 'fcp-cap',
              'aria-pressed': selected === expert.id,
              onClick: () => setSelected((prev) => prev === expert.id ? '' : expert.id),
            }, expert.name))
          ),
          h('div', { className: 'fcp-composer' },
            selectedFiles.length > 0 || selectedSkills.length > 0 ? h('div', { className: 'fcp-choices' },
              selectedFiles.map((name) => h('span', { key: 'f:' + name, className: 'fcp-pick-chip' }, '文件：' + name,
                h('button', { type: 'button', 'aria-label': '移除文件 ' + name, onClick: () => setSelectedFiles((list) => list.filter((item) => item !== name)) }, '×'))),
              selectedSkills.map((id) => h('span', { key: 's:' + id, className: 'fcp-pick-chip' }, '技能：' + id,
                h('button', { type: 'button', 'aria-label': '移除技能 ' + id, onClick: () => setSelectedSkills((list) => list.filter((item) => item !== id)) }, '×')))
            ) : null,
            snips.length > 0 ? h('div', { className: 'fcp-choices' }, snips.map((item, index) => h('div', { key: index, className: 'fcp-snip' },
              h('img', { src: item.dataUrl, alt: '截图' }),
              h('button', { type: 'button', 'aria-label': '移除截图', onClick: () => setSnips((list) => list.filter((_, i) => i !== index)) }, '×')
            ))) : null,
            h('textarea', {
              ref: inputRef, className: 'fcp-input', rows: 1, value,
              placeholder: '描述你的任务；不选专家时，系统会自动调度…',
              onChange: (event) => { setValue(event.target.value); const el = event.target; el.style.height = 'auto'; el.style.height = Math.max(43, Math.min(el.scrollHeight, 160)) + 'px' }, onKeyDown, onPaste,
            }),
            h('div', { className: 'fcp-tools' },
              h('div', { ref: plusRef, style: { position: 'relative' } },
                h('button', { type: 'button', className: 'fcp-iconbtn fcp-plus', 'aria-label': '添加', onClick: () => { setPlusOpen((open) => !open); setModelOpen(false) } }, h(Icon, { d: I.plus, size: 20 })),
                plusOpen ? h('div', { className: 'fcp-pop' },
                  h('button', { type: 'button', onClick: () => { if (fileRef.current) fileRef.current.click() } }, '选择文件'),
                  h('div', { style: { position: 'relative' } },
                    h('button', { type: 'button', onClick: () => setSkillMenuOpen((open) => !open), onMouseEnter: () => setSkillMenuOpen(true) }, '选择技能 ›'),
                    skillMenuOpen ? h('div', { className: 'fcp-submenu' },
                      h('input', { className: 'fcp-search', placeholder: '搜索已安装技能…', value: skillQuery, onChange: (event) => setSkillQuery(event.target.value), autoFocus: true }),
                      h('div', { className: 'fcp-submenu-list' },
                        (SKILLS.map((item) => [item[0], item[1], item[2], item[3]]).concat(extraSkills.map((name) => [name, name, '已安装技能', '自定义']))).filter((item) => skillQuery === '' || (item[1] + item[2] + item[0]).toLowerCase().includes(skillQuery.toLowerCase())).map((item) => h('button', {
                          key: item[0], type: 'button', className: 'fcp-submenu-item',
                          onClick: () => toggleSkill(item[0]),
                        }, h('span', { style: { width: 16 } }, selectedSkills.includes(item[0]) ? '✓' : ''), h('span', { style: { flex: 1 } }, item[1]), h('span', { style: { color: 'var(--fcp-text3)', fontSize: 10 } }, item[3])))
                      ),
                      h('div', { className: 'fcp-submenu-foot' }, h('button', { type: 'button', className: 'fcp-btn', onClick: () => { setSkillMenuOpen(false); setPlusOpen(false) } }, '完成'))
                    ) : null
                  )
                ) : null
              ),
              h('button', { type: 'button', className: 'fcp-iconbtn', 'aria-label': '截图', title: '截图并复制到剪贴板', disabled: snipBusy, onClick: snip }, h(Icon, { d: I.scissors, size: 17 })),
              h('div', { ref: modeRef, style: { position: 'relative' } },
                h('button', { type: 'button', className: 'fcp-mode', 'aria-label': '工作模式', title: '工作模式', onClick: () => { setModeOpen((open) => !open); setPlusOpen(false); setModelOpen(false) } },
                  h('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true' }, h('path', { d: 'M12 2l2.4 5.2 5.6.7-4.1 3.9 1.1 5.6L12 14.9 7 17.4l1.1-5.6L4 7.9l5.6-.7z' })),
                  (WORK_MODES.find((m) => m.id === modeId) || WORK_MODES[0]).name,
                  h(Icon, { d: I.chevron, size: 14 })
                ),
                modeOpen ? h('div', { className: 'fcp-mode-menu' },
                  WORK_MODES.map((mode) => h('button', {
                    key: mode.id, type: 'button', className: 'fcp-mode-item',
                    onClick: () => { setModeId(mode.id); saveJson(MODE_KEY, mode.id); setModeOpen(false) },
                  },
                    h('b', null, mode.name),
                    h('span', null, mode.desc),
                    modeId === mode.id ? h('span', { className: 'check' }, '✓') : null
                  ))
                ) : null
              ),
              h('div', { ref: modelRef, style: { position: 'relative', marginLeft: 'auto' } },
                h('button', { type: 'button', className: 'fcp-model', title: model, onClick: () => { setModelOpen((open) => !open); setPlusOpen(false); setModeOpen(false) } },
                  model, h(Icon, { d: I.chevron, size: 16 })
                ),
                modelOpen ? h('div', { className: 'fcp-pop', style: { left: 'auto', right: 0, minWidth: 240, maxHeight: 320, overflow: 'auto' } },
                  modelOptions.map((item) => h('button', {
                    key: item.id, type: 'button',
                    onClick: () => { setModel(modelFullName(item)); setModelOpen(false); saveJson(ACTIVE_MODEL_KEY, item.id) },
                  }, modelFullName(item) + (item.provider ? ' · ' + item.provider : '')))
                ) : null
              ),
              h('button', { type: 'button', className: 'fcp-iconbtn', 'aria-label': '语音输入', title: '语音输入', onClick: () => setError('语音输入请使用系统输入法；本工作台保留话筒入口。') }, h(Icon, { d: I.mic, size: 20 })),
              h('button', { type: 'button', className: 'fcp-send', 'aria-label': '发送', disabled: value.trim() === '' || routing, onClick: submit }, h(Icon, { d: I.arrow, size: 20 }))
            )
          ),
          error !== '' ? h('div', { className: 'fcp-meta', style: { color: '#b3261e' } }, error) : null
        )
      )
    }

    function PageShell({ ctx }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: '100vh' } },
        h(Boundary, null, h(FcpPage, { ctx }))
      )
    }

    function FcpDock({ sessionId, ctx }) {
      const [expert, setExpert] = useState(null)
      useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId === '') return undefined
        let alive = true
        const pending = readPending()
        const request = pending
          ? fetch(API.bind, {
              method: 'POST',
              headers: SEND_HEADERS,
              body: JSON.stringify({ sessionId, expertId: pending.expertId }),
            })
          : fetch(API.state + '?sessionId=' + encodeURIComponent(sessionId), { cache: 'no-store' })
        if (pending) {
          try { localStorage.removeItem(PENDING_KEY) } catch (error) { /* ignore */ }
        }
        request.then((res) => res.json()).then((data) => {
          if (!alive || !data || !data.ok || !data.value) return
          setExpert(data.value.expert || null)
        }).catch(() => {})
        return () => { alive = false }
      }, [sessionId])
      if (!expert) return null
      const backToWorkbench = () => {
        try {
          const layout = typeof ctx.get === 'function' ? ctx.get('layout') : undefined
          if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID)
        } catch (error) { /* ignore */ }
      }
      return h('button', { type: 'button', className: 'fcp-dock', title: '返回消保工作台首页（当前：' + expert.name + '）', onClick: backToWorkbench },
        h('span', { className: 'fcp-dot', 'aria-hidden': 'true' }),
        h('span', { className: 'fcp-dock-back' }, '← 工作台 · ' + expert.name)
      )
    }

    const IMA_ICON = 'data:image/png;base64,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'
    const OBSIDIAN_ICON = 'data:image/svg+xml;base64,PHN2ZyBmaWxsPSJub25lIiBoZWlnaHQ9IjEwMCUiIHdpZHRoPSIxMDAlIiB2aWV3Qm94PSIwIDAgNTEyIDUxMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4NCgk8cmFkaWFsR3JhZGllbnQgaWQ9ImxvZ28tYm90dG9tLWxlZnQiIGN4PSIwIiBjeT0iMCIgZ3JhZGllbnRUcmFuc2Zvcm09Im1hdHJpeCgtNTkgLTIyNSAxNTAgLTM5IDE2MS40IDQ3MCkiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIiByPSIxIj4NCgkJPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjZmZmIiBzdG9wLW9wYWNpdHk9Ii40Ii8+DQoJCTxzdG9wIG9mZnNldD0iMSIgc3RvcC1vcGFjaXR5PSIuMSIvPg0KCTwvcmFkaWFsR3JhZGllbnQ+DQoJPHJhZGlhbEdyYWRpZW50IGlkPSJsb2dvLXRvcC1yaWdodCIgY3g9IjAiIGN5PSIwIiBncmFkaWVudFRyYW5zZm9ybT0ibWF0cml4KDUwIC0zNzkgMjgwIDM3IDM2MCAzNzQuMikiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIiByPSIxIj4NCgkJPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjZmZmIiBzdG9wLW9wYWNpdHk9Ii42Ii8+DQoJCTxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2ZmZiIgc3RvcC1vcGFjaXR5PSIuMSIvPg0KCTwvcmFkaWFsR3JhZGllbnQ+DQoJPHJhZGlhbEdyYWRpZW50IGlkPSJsb2dvLXRvcC1sZWZ0IiBjeD0iMCIgY3k9IjAiIGdyYWRpZW50VHJhbnNmb3JtPSJtYXRyaXgoNjkgLTMxOSAyMTggNDcgMTc1LjQgMzA3KSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIHI9IjEiPg0KCQk8c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNmZmYiIHN0b3Atb3BhY2l0eT0iLjgiLz4NCgkJPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjZmZmIiBzdG9wLW9wYWNpdHk9Ii40Ii8+DQoJPC9yYWRpYWxHcmFkaWVudD4NCgk8cmFkaWFsR3JhZGllbnQgaWQ9ImxvZ28tYm90dG9tLXJpZ2h0IiBjeD0iMCIgY3k9IjAiIGdyYWRpZW50VHJhbnNmb3JtPSJtYXRyaXgoLTk2IC0xNjMgMTg3IC0xMTEgMzM1LjMgNTEyLjIpIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgcj0iMSI+DQoJCTxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iI2ZmZiIgc3RvcC1vcGFjaXR5PSIuMyIvPg0KCQk8c3RvcCBvZmZzZXQ9IjEiIHN0b3Atb3BhY2l0eT0iLjMiLz4NCgk8L3JhZGlhbEdyYWRpZW50Pg0KCTxyYWRpYWxHcmFkaWVudCBpZD0ibG9nby10b3AtZWRnZSIgY3g9IjAiIGN5PSIwIiBncmFkaWVudFRyYW5zZm9ybT0ibWF0cml4KC0zNiAxNjYgLTExMiAtMjQgMzEwIDEyOC4yKSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIHI9IjEiPg0KCQk8c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNmZmYiIHN0b3Atb3BhY2l0eT0iMCIvPg0KCQk8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNmZmYiIHN0b3Atb3BhY2l0eT0iLjIiLz4NCgk8L3JhZGlhbEdyYWRpZW50Pg0KCTxyYWRpYWxHcmFkaWVudCBpZD0ibG9nby1sZWZ0LWVkZ2UiIGN4PSIwIiBjeT0iMCIgZ3JhZGllbnRUcmFuc2Zvcm09Im1hdHJpeCg4OCA4OSAtMTkwIDE4NyAxMTEgMjIwLjIpIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgcj0iMSI+DQoJCTxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iI2ZmZiIgc3RvcC1vcGFjaXR5PSIuMiIvPg0KCQk8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNmZmYiIHN0b3Atb3BhY2l0eT0iLjQiLz4NCgk8L3JhZGlhbEdyYWRpZW50Pg0KCTxyYWRpYWxHcmFkaWVudCBpZD0ibG9nby1ib3R0b20tZWRnZSIgY3g9IjAiIGN5PSIwIiBncmFkaWVudFRyYW5zZm9ybT0ibWF0cml4KDkgMTMwIC0yNzYgMjAgMjE1IDI4NCkiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIiByPSIxIj4NCgkJPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjZmZmIiBzdG9wLW9wYWNpdHk9Ii4yIi8+DQoJCTxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2ZmZiIgc3RvcC1vcGFjaXR5PSIuMyIvPg0KCTwvcmFkaWFsR3JhZGllbnQ+DQoJPHJhZGlhbEdyYWRpZW50IGlkPSJsb2dvLW1pZGRsZS1lZGdlIiBjeD0iMCIgY3k9IjAiIGdyYWRpZW50VHJhbnNmb3JtPSJtYXRyaXgoLTE5OCAtMTA0IDMyNyAtNjIzIDQwMCAzOTkuMikiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIiByPSIxIj4NCgkJPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjZmZmIiBzdG9wLW9wYWNpdHk9Ii4yIi8+DQoJCTxzdG9wIG9mZnNldD0iLjUiIHN0b3AtY29sb3I9IiNmZmYiIHN0b3Atb3BhY2l0eT0iLjIiLz4NCgkJPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjZmZmIiBzdG9wLW9wYWNpdHk9Ii4zIi8+DQoJPC9yYWRpYWxHcmFkaWVudD4NCgk8Y2xpcFBhdGggaWQ9ImNsaXAiPg0KCQk8cGF0aCBkPSJNLjIuMmg1MTJ2NTEySC4yeiIvPg0KCTwvY2xpcFBhdGg+DQoJPGcgY2xpcC1wYXRoPSJ1cmwoI2NsaXApIj4NCgkJPHBhdGggZD0iTTM4Mi4zIDQ3NS42Yy0zLjEgMjMuNC0yNiA0MS42LTQ4LjcgMzUuMy0zMi40LTguOS02OS45LTIyLjgtMTAzLjYtMjUuNGwtNTEuNy00YTM0IDM0IDAgMCAxLTIyLTEwLjJsLTg5LTkxLjdhMzQgMzQgMCAwIDEtNi43LTM3LjdzNTUtMTIxIDU3LjEtMTI3LjNjMi02LjMgOS42LTYxLjIgMTQtOTAuNiAxLjItNy45IDUtMTUgMTEtMjAuM0wyNDggOC45YTM0LjEgMzQuMSAwIDAgMSA0OS42IDQuM0wzODYgMTI1LjZhMzcgMzcgMCAwIDEgNy42IDIyLjRjMCAyMS4zIDEuOCA2NSAxMy42IDkzLjIgMTEuNSAyNy4zIDMyLjUgNTcgNDMuNSA3MS41YTE3LjMgMTcuMyAwIDAgMSAxLjMgMTkuMiAxNDk0IDE0OTQgMCAwIDEtNDQuOCA3MC42Yy0xNSAyMi4zLTIxLjkgNDkuOS0yNSA3My4xeiIgZmlsbD0iIzZjMzFlMyIvPg0KCQk8cGF0aCBkPSJNMTY1LjkgNDc4LjNjNDEuNC04NCA0MC4yLTE0NC4yIDIyLjYtMTg3LTE2LjItMzkuNi00Ni4zLTY0LjUtNzAtODAtLjYgMi4zLTEuMyA0LjQtMi4yIDYuNUw2MC42IDM0MmEzNCAzNCAwIDAgMCA2LjYgMzcuN2w4OS4xIDkxLjdhMzQgMzQgMCAwIDAgOS42IDd6IiBmaWxsPSJ1cmwoI2xvZ28tYm90dG9tLWxlZnQpIi8+DQoJCTxwYXRoIGQ9Ik0yNzguNCAzMDcuOGMxMS4yIDEuMiAyMi4yIDMuNiAzMi44IDcuNiAzNCAxMi43IDY1IDQxLjIgOTAuNSA5Ni4zIDEuOC0zLjEgMy42LTYuMiA1LjYtOS4yYTE1MzYgMTUzNiAwIDAgMCA0NC44LTcwLjYgMTcgMTcgMCAwIDAtMS4zLTE5LjJjLTExLTE0LjYtMzItNDQuMi00My41LTcxLjUtMTEuOC0yOC4yLTEzLjUtNzItMTMuNi05My4yIDAtOC4xLTIuNi0xNi03LjYtMjIuNEwyOTcuNiAxMy4yYTM0IDM0IDAgMCAwLTEuNS0xLjcgOTYgOTYgMCAwIDEgMiA1NCAxOTguMyAxOTguMyAwIDAgMS0xNy42IDQxLjNsLTcuMiAxNC4yYTE3MSAxNzEgMCAwIDAtMTkuNCA3MWMtMS4yIDI5LjQgNC44IDY2LjQgMjQuNSAxMTUuOHoiIGZpbGw9InVybCgjbG9nby10b3AtcmlnaHQpIi8+DQoJCTxwYXRoIGQ9Ik0yNzguNCAzMDcuOGMtMTkuNy00OS40LTI1LjgtODYuNC0yNC41LTExNS45YTE3MSAxNzEgMCAwIDEgMTkuNC03MWMyLjMtNC44IDQuOC05LjUgNy4yLTE0LjEgNy4xLTEzLjkgMTQtMjcgMTcuNi00MS40YTk2IDk2IDAgMCAwLTItNTRBMzQuMSAzNC4xIDAgMCAwIDI0OCA5bC0xMDUuNCA5NC44YTM0LjEgMzQuMSAwIDAgMC0xMC45IDIwLjNsLTEyLjggODUtLjUgMi4zYzIzLjggMTUuNSA1NCA0MC40IDcwLjEgODBhMTQ3IDE0NyAwIDAgMSA3LjggMjQuOGMyOC02LjggNTUuNy0xMSA4Mi4xLTguM3oiIGZpbGw9InVybCgjbG9nby10b3AtbGVmdCkiLz4NCgkJPHBhdGggZD0iTTMzMy42IDUxMWMyMi43IDYuMiA0NS42LTEyIDQ4LjctMzUuNGExODcgMTg3IDAgMCAxIDE5LjQtNjMuOWMtMjUuNi01NS01Ni41LTgzLjYtOTAuNC05Ni4zLTM2LTEzLjQtNzUuMi05LTExNSAuNyA4LjkgNDAuNCAzLjYgOTMuMy0zMC40IDE2Mi4yIDQgMS44IDguMSAzIDEyLjUgMy4zIDAgMCAyNC40IDIgNTMuNiA0LjEgMjkgMiA3Mi40IDE3LjEgMTAxLjYgMjUuMnoiIGZpbGw9InVybCgjbG9nby1ib3R0b20tcmlnaHQpIi8+DQoJCTxnIGNsaXAtcnVsZT0iZXZlbm9kZCIgZmlsbC1ydWxlPSJldmVub2RkIj4NCgkJCTxwYXRoIGQ9Ik0yNTQuMSAxOTBjLTEuMyAyOS4yIDIuNCA2Mi44IDIyLjEgMTEyLjFsLTYuMi0uNWMtMTcuNy01MS41LTIxLjUtNzgtMjAuMi0xMDcuNmExNzQuNyAxNzQuNyAwIDAgMSAyMC40LTcyYzIuNC00LjkgOC0xNC4xIDEwLjUtMTguOCA3LjEtMTMuNyAxMS45LTIxIDE2LTMzLjYgNS43LTE3LjUgNC41LTI1LjkgMy44LTM0LjEgNC42IDI5LjktMTIuNyA1Ni0yNS43IDgyLjRhMTc3LjEgMTc3LjEgMCAwIDAtMjAuNyA3MnoiIGZpbGw9InVybCgjbG9nby10b3AtZWRnZSkiLz4NCgkJCTxwYXRoIGQ9Ik0xOTQuMyAyOTMuNGMyLjQgNS40IDQuNiA5LjggNiAxNi41TDE5NSAzMTFjLTIuMS03LjgtMy44LTEzLjQtNi44LTIwLTE3LjgtNDItNDYuMy02My42LTY5LjctNzkuNSAyOC4yIDE1LjIgNTcuMiAzOSA3NS43IDgxLjl6IiBmaWxsPSJ1cmwoI2xvZ28tbGVmdC1lZGdlKSIvPg0KCQkJPHBhdGggZD0iTTIwMC42IDMxNS4xYzkuOCA0Ni0xLjIgMTA0LjItMzMuNiAxNjAuOSAyNy4xLTU2LjIgNDAuMi0xMTAuMSAyOS4zLTE2MHoiIGZpbGw9InVybCgjbG9nby1ib3R0b20tZWRnZSkiLz4NCgkJCTxwYXRoIGQ9Ik0zMTIuNSAzMTFjNTMuMSAxOS45IDczLjYgNjMuNiA4OC45IDEwMC0xOS0zOC4xLTQ1LjItODAuMy05MC44LTk2LTM0LjgtMTEuOC02NC4xLTEwLjQtMTE0LjMgMWwtMS4xLTVjNTMuMi0xMi4xIDgxLTEzLjUgMTE3LjMgMHoiIGZpbGw9InVybCgjbG9nby1taWRkbGUtZWRnZSkiLz4NCgkJPC9nPg0KCTwvZz4NCjwvc3ZnPg0K'

    function ImaMark({ size = 22, active = false }) {
      return h('img', { src: IMA_ICON, width: size, height: size, alt: 'IMA', style: { objectFit: 'contain', display: 'block', filter: active ? 'drop-shadow(0 0 1px rgba(0,0,0,.22))' : 'grayscale(1) drop-shadow(0 0 1px rgba(0,0,0,.22))' } })
    }

    function ObsidianMark({ size = 22, active = false }) {
      return h('img', { src: OBSIDIAN_ICON, width: size, height: size, alt: 'Obsidian', style: { objectFit: 'contain', display: 'block', filter: active ? 'none' : 'grayscale(1)' } })
    }

    function GearMark({ size = 22 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0a2.34 2.34 0 0 0 3.319 1.915a2.34 2.34 0 0 1 2.33 4.033a2.34 2.34 0 0 0 0 3.831a2.34 2.34 0 0 1-2.33 4.033a2.34 2.34 0 0 0-3.319 1.915a2.34 2.34 0 0 1-4.659 0a2.34 2.34 0 0 0-3.32-1.915a2.34 2.34 0 0 1-2.33-4.033a2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915' }),
        h('circle', { cx: 12, cy: 12, r: 3 })
      )
    }

    function ConfigShell({ title, subtitle, onBack, children }) {
      return h('div', { className: 'fcp-page' },
        h('div', { className: 'fcp-page-inner' },
          h('button', { type: 'button', className: 'fcp-back', onClick: onBack }, '← 返回工作台'),
          h('h2', null, title),
          subtitle ? h('div', { className: 'sub' }, subtitle) : null,
          children
        )
      )
    }

    function ImaPage({ config, onBack, onSaved }) {
      const [apiKey, setApiKey] = useState(config.ima.apiKey || '')
      const [clientId, setClientId] = useState(config.ima.clientId || '')
      const [status, setStatus] = useState(config.ima.configured ? '已连接' : '未连接')
      const [kbs, setKbs] = useState([])
      const [selected, setSelected] = useState(() => loadJson('dsh:plugin:fcp:imaExtra', []))
      const [loading, setLoading] = useState(false)
      const [kbError, setKbError] = useState('')

      const loadKbs = (key, client) => {
        if (!key || !client) { setKbError('请先填写并保存 API Key 与 Client ID'); return }
        setLoading(true); setKbError('')
        fetch(API.imaKbs, { method: 'POST', headers: SEND_HEADERS, body: JSON.stringify({ apiKey: key, clientId: client }) })
          .then((response) => readJsonResponse(response))
          .then((data) => {
            if (!data || !data.ok) throw new Error(data && data.error ? data.error : '知识库加载失败')
            const list = Array.isArray(data.value.knowledgeBases) ? data.value.knowledgeBases : []
            setKbs(list)
            saveJson('dsh:plugin:fcp:imaKbList', list)
          })
          .catch((error) => setKbError(String((error && error.message) || error)))
          .finally(() => setLoading(false))
      }
      useEffect(() => {
        if (config.ima.apiKey && config.ima.clientId) loadKbs(config.ima.apiKey, config.ima.clientId)
      }, [])

      const saveCredentials = () => {
        const next = { ...config, ima: { apiKey: apiKey.trim(), clientId: clientId.trim(), configured: apiKey.trim() !== '' } }
        onSaved(next)
        setStatus(next.ima.configured ? '已连接' : '未连接')
        syncKbConfig(next, kbs)
        if (next.ima.apiKey && next.ima.clientId) loadKbs(next.ima.apiKey, next.ima.clientId)
      }
      const saveKbs = () => {
        saveJson('dsh:plugin:fcp:imaExtra', selected)
        saveJson('dsh:plugin:fcp:imaKbList', kbs)
        syncKbConfig(config, kbs)
        window.dispatchEvent(new CustomEvent('fcp:ima-changed'))
      }
      const toggleKb = (id) => setSelected((list) => list.includes(id) ? list.filter((item) => item !== id) : list.concat(id))

      return h(ConfigShell, { title: 'IMA 知识库', subtitle: '系统优先读取「国家法律知识库」「八大权益消保知识库」，其余知识库可按需勾选。', onBack },
        // 上半部分：凭证配置
        h('div', null,
          h('div', { style: { fontSize: 13, lineHeight: 1.8, color: 'var(--fcp-text2)', marginBottom: 14 } },
            '通过 IMA 开放平台获取 API Key 与 Client ID 后，系统即可检索「国家法律知识库」与「八大权益消保知识库」，让每条结论都有据可依、引用可溯。'),
          h('div', { className: 'fcp-field' }, h('label', null, 'API Key'), h('input', { className: 'fcp-input2', type: 'password', value: apiKey, placeholder: '填写你的 IMA API Key', onChange: (event) => setApiKey(event.target.value) })),
          h('div', { className: 'fcp-field' }, h('label', null, 'Client ID'), h('input', { className: 'fcp-input2', value: clientId, placeholder: '填写你的 IMA Client ID', onChange: (event) => setClientId(event.target.value) })),
          h('div', { className: 'fcp-actions' },
            h('button', { type: 'button', className: 'fcp-btn primary', onClick: saveCredentials }, '保存凭证'),
            h('span', { className: 'fcp-pick-count', style: { alignSelf: 'center' } }, status)
          )
        ),
        h('hr', { className: 'fcp-hr' }),
        // 下半部分：可选择知识库表格
        h('div', null,
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('h3', { style: { fontSize: 15, margin: 0, flex: 1 } }, '可选择知识库'),
            h('span', { className: 'fcp-pick-count' }, '已选 ' + selected.length + ' 个'),
            h('button', { type: 'button', className: 'fcp-btn', onClick: () => loadKbs(apiKey || config.ima.apiKey, clientId || config.ima.clientId) }, '刷新')
          ),
          h('div', { style: { fontSize: 12, color: 'var(--fcp-text3)', margin: '6px 0' } }, '国家法律知识库、八大权益消保知识库为固定阅读，无需勾选。'),
          kbError !== '' ? h('div', { className: 'sub', style: { color: '#b3261e' } }, kbError) : null,
          loading ? h('div', { className: 'fcp-empty' }, '正在加载知识库…') : null,
          !loading && kbs.length === 0 && kbError === '' ? h('div', { className: 'fcp-empty' }, '暂无知识库，保存凭证后会自动加载') : null,
          kbs.length > 0 ? h('div', { className: 'fcp-kb-table' }, kbs.map((kb, index) => h('label', { key: kb.id || index, className: 'fcp-kb-table-row' },
            h('input', { type: 'checkbox', checked: selected.includes(kb.id), onChange: () => toggleKb(kb.id) }),
            h('span', { className: 'grow' }, kb.name),
            h('span', { className: 'kb-id' }, kb.id)
          ))) : null,
          h('div', { className: 'fcp-actions' }, h('button', { type: 'button', className: 'fcp-btn primary', onClick: saveKbs }, '保存知识库选择'))
        )
      )
    }

    function ObsidianPage({ config, onBack, onSaved }) {
      const [vault, setVault] = useState(config.obsidian.vault || '')
      const [vaultPickerOpen, setVaultPickerOpen] = useState(false)
      const [vaultPath, setVaultPath] = useState('')
      const [vaultEntries, setVaultEntries] = useState([])
      const [vaultLoading, setVaultLoading] = useState(false)
      const [vaultError, setVaultError] = useState('')
      const [status, setStatus] = useState(config.obsidian.configured ? '已绑定' : '未绑定')
      const bind = () => {
        const next = { ...config, obsidian: { vault: vault.trim(), configured: vault.trim() !== '' } }
        onSaved(next)
        setStatus(next.obsidian.configured ? '已绑定' : '未绑定')
      }
      return h(ConfigShell, { title: 'Obsidian', subtitle: '主动绑定 vault 后，专家可检索你的笔记；首版只读。', onBack },
        h('div', { className: 'fcp-field' }, h('label', null, 'Vault 路径'), h('input', { className: 'fcp-input2', value: vault, placeholder: '例如 ~/Documents/我的笔记', onChange: (event) => setVault(event.target.value) })),
        h('div', { className: 'fcp-actions' },
          h('button', { type: 'button', className: 'fcp-btn primary', onClick: bind }, '绑定 Vault'),
          h('span', { className: 'fcp-pick-count', style: { alignSelf: 'center' } }, status)
        )
      )
    }

    function SettingsPage({ tab: initialTab, onBack, config, onSaved, models, setModels, ctx, installedIds = [] }) {
      const [tab, setTab] = useState(initialTab || 'experts')
      const [customExperts, setCustomExperts] = useState(() => loadJson(EXPERTS_CUSTOM_KEY, []))
      const [catalogSkills, setCatalogSkills] = useState([])
      const [catalogCategories, setCatalogCategories] = useState([])
      const [catalogInfo, setCatalogInfo] = useState(null)
      const [catalogMeta, setCatalogMeta] = useState(null)
      const [skillsLoading, setSkillsLoading] = useState(false)
      const [skillBusy, setSkillBusy] = useState('')
      const [skillError, setSkillError] = useState('')
      const [skillDetail, setSkillDetail] = useState(null)
      const [thinkingCards, setThinkingCards] = useState(() => {
        const raw = loadJson(THINKING_KEY, null)
        if (Array.isArray(raw)) return raw
        if (raw && Array.isArray(raw.methods)) return raw.methods.map((item, index) => ({ id: 'builtin-' + index, name: item[0], desc: item[1], version: item[2] || 'v1', builtin: true }))
        return BUILTIN_THINKING.map((item, index) => ({ id: 'builtin-' + index, name: item[0], desc: item[1], version: item[2] || 'v1', builtin: true }))
      })
      const [kbFiles, setKbFiles] = useState(() => loadJson(KB_FILES_KEY, []))

      // 从 Host 拉取已上传知识库列表；失败时保留 localStorage 回退
      const loadKbList = () => {
        fetch(API.kbList, { cache: 'no-store' })
          .then((response) => readJsonResponse(response))
          .then((data) => {
            if (!data || !data.ok || !Array.isArray(data.value)) return
            setKbFiles(data.value)
            saveJson(KB_FILES_KEY, data.value)
          })
          .catch(() => {})
      }

      const [imaKey, setImaKey] = useState(config.ima.apiKey || '')
      const [imaClient, setImaClient] = useState(config.ima.clientId || '')
      const [extraKbs, setExtraKbs] = useState(() => loadJson('dsh:plugin:fcp:imaExtra', []))
      const [imaKbs, setImaKbs] = useState([])
      const [imaKbLoading, setImaKbLoading] = useState(false)
      const [imaKbError, setImaKbError] = useState('')
      const [vault, setVault] = useState(config.obsidian.vault || '')
      const [vaultPickerOpen, setVaultPickerOpen] = useState(false)
      const [vaultPath, setVaultPath] = useState('')
      const [vaultEntries, setVaultEntries] = useState([])
      const [vaultLoading, setVaultLoading] = useState(false)
      const [vaultError, setVaultError] = useState('')
      const [msg, setMsg] = useState('')
      const [skillSearch, setSkillSearch] = useState('')
      const [skillView, setSkillView] = useState('all')
      const [skillCat, setSkillCat] = useState('all')
      const [modelForm, setModelForm] = useState({ name: '', provider: 'DeepSeek', id: '', cloud: true, apiKey: '', baseUrl: '' })
      const [activeModel, setActiveModel] = useState(() => loadJson(ACTIVE_MODEL_KEY, ''))
      const [advancedOpen, setAdvancedOpen] = useState(false)
      const expertAddRef = useRef(null)
      const thinkingRef = useRef(null)
      const kbRef = useRef(null)
      const tabs = [['experts', '专家配置'], ['skills', '技能配置'], ['knowledge', '知识配置'], ['thinking', '思维配置'], ['models', '模型设置'], ['help', '帮助']]

      const reloadSkills = async (refresh = false) => {
        setSkillsLoading(true)
        setSkillError('')
        try {
          const response = await fetch(API.skillCatalog + (refresh ? '?refresh=1' : ''), { cache: 'no-store' })
          const data = await readJsonResponse(response)
          if (!data || !data.ok || !data.value || !data.value.catalog) throw new Error(data && data.error ? data.error : '技能目录加载失败')
          const catalog = data.value.catalog
          const installedSet = new Set(Array.isArray(data.value.installed) ? data.value.installed : [])
          setCatalogInfo({ title: (catalog.title && (catalog.title.zh || catalog.title.en)) || '金融技能', updated: catalog.updated || '', upstreamSite: catalog.upstreamSite || 'https://github.com/openfcp/awesome-financial-skills' })
          setCatalogCategories(Array.isArray(catalog.categories) ? catalog.categories : [])
          setCatalogMeta(data.value.meta || null)
          // 与 dsh-financial-skills v0.2.3 的归一化字段保持一致（name/summary 双语、source、version、license、author、tags）
          setCatalogSkills((Array.isArray(catalog.skills) ? catalog.skills : []).map((skill) => ({
            id: skill.id,
            name: (skill.name && (skill.name.zh || skill.name.en)) || skill.id,
            nameEn: skill.name && skill.name.en && skill.name.en !== (skill.name.zh || skill.name.en) ? skill.name.en : '',
            desc: (skill.summary && (skill.summary.zh || skill.summary.en)) || '',
            category: skill.category || 'other',
            tags: Array.isArray(skill.tags) ? skill.tags : [],
            version: skill.version || '',
            author: skill.author || '',
            license: skill.license || '',
            sourceType: (skill.source && skill.source.type) || '',
            sourceLabel: skill.source && skill.source.type === 'github' ? 'GitHub' : skill.source && skill.source.type === 'skillhub' ? 'SkillHub' : (skill.source && skill.source.namespace) || '',
            verifiedAt: skill.verifiedAt || skill.verified_at || catalog.verifiedAt || catalog.verified_at || '',
            invocationName: skill.invocationName || skill.installedInvocationName || '',
            installed: skill.installed === true || installedSet.has(skill.id),
            installedVersion: skill.installedVersion || '',
            system: SKILLS.some((item) => item[0] === skill.id),
          })))
        } catch (error) {
          setSkillError(String((error && error.message) || error))
        } finally {
          setSkillsLoading(false)
        }
      }
      const manageSkill = (skill, action) => {
        setSkillBusy(skill.id)
        setSkillError('')
        fetch('api/fcp/skill-' + action, { method: 'POST', headers: SEND_HEADERS, body: JSON.stringify({ id: skill.id, name: skill.name }) })
          .then((res) => readJsonResponse(res))
          .then((data) => { if (!data || !data.ok) throw new Error(data && data.error ? data.error : '操作失败'); reloadSkills(); window.dispatchEvent(new CustomEvent('fcp:skills-changed')) })
          .catch((error) => setSkillError(String((error && error.message) || error)))
          .finally(() => setSkillBusy(''))
      }
      const openSkillDetail = (skill) => {
        // 立即用卡片已有信息兜底展示，内置技能不在远端目录时也能看详情，不依赖接口成功
        const fallback = {
          id: skill.id,
          version: skill.version || '',
          license: skill.license || '',
          author: skill.author || '',
          tags: Array.isArray(skill.tags) ? skill.tags : [],
          summary: null,
          markdown: '',
        }
        setSkillDetail({ skill, loading: false, data: fallback })
        fetch(API.skillDetail + '?id=' + encodeURIComponent(skill.id), { cache: 'no-store' })
          .then((res) => readJsonResponse(res))
          .then((data) => { if (data && data.ok && data.value) setSkillDetail({ skill, loading: false, data: { ...fallback, ...data.value } }) })
          .catch(() => { /* 保留兜底详情，不打断查看 */ })
      }

      useEffect(() => { if (tab === 'skills' && catalogSkills.length === 0) reloadSkills() }, [tab])

      useEffect(() => { if (tab === 'knowledge' && imaKbs.length === 0 && config.ima.apiKey !== '' && config.ima.clientId !== '') loadImaKbs(config.ima.apiKey, config.ima.clientId) }, [tab])
      // 进入知识配置页：拉取已上传知识库 + 把当前配置同步给 Host 工具，确保开箱即用
      useEffect(() => {
        if (tab !== 'knowledge') return
        loadKbList()
        syncKbConfig(config, loadJson('dsh:plugin:fcp:imaKbList', imaKbs))
      }, [tab])

      const persistExperts = (list) => { setCustomExperts(list); saveJson(EXPERTS_CUSTOM_KEY, list) }
      const persistThinkingCards = (list) => { setThinkingCards(list); saveJson(THINKING_KEY, list) }
      const addThinkingFile = (file) => {
        if (!file) return
        const name = file.name.replace(/\.md$/i, '')
        const reader = new FileReader()
        reader.onload = () => {
          const text = String(reader.result || '').replace(/^#+\s*/gm, '').split('\n').filter((line) => line.trim() !== '').slice(0, 1).join(' ').slice(0, 60)
          persistThinkingCards(thinkingCards.concat({ id: 'think-' + Date.now(), name, desc: text || '自定义思维方式 · ' + file.name, version: 'v1', builtin: false }))
          setMsg('已添加思维方式：' + name)
        }
        reader.readAsText(file)
      }
      const persistKb = (list) => { setKbFiles(list); saveJson(KB_FILES_KEY, list) }
      const removeKb = (id) => {
        fetch(API.kbRemove, { method: 'POST', headers: SEND_HEADERS, body: JSON.stringify({ id }) })
          .then((response) => readJsonResponse(response))
          .then((data) => { if (!data || !data.ok) throw new Error(data && data.error ? data.error : '删除失败'); loadKbList(); setMsg('已从本地知识库移除') })
          .catch((error) => setMsg('删除失败：' + String((error && error.message) || error)))
      }
      const persistModels = (list) => { setModels(list); saveJson(MODELS_KEY, list) }

      const addCustomExpert = (file) => {
        if (!file) return
        const name = file.name.replace(/\.md$/i, '')
        persistExperts(customExperts.concat({ id: 'custom-' + Date.now(), name, summary: '自定义专家 · ' + file.name, custom: true, enabled: true }))
      }
      const addKbFile = (file) => {
        if (!file) return
        setMsg('正在上传并索引：' + file.name)
        const isZip = /\.zip$/i.test(file.name)
        const reader = new FileReader()
        reader.onerror = () => setMsg('读取文件失败')
        reader.onload = () => {
          const payload = { name: file.name }
          if (isZip) payload.base64 = String(reader.result || '').split(',').pop() || ''
          else payload.text = String(reader.result || '')
          fetch(API.kbUpload, { method: 'POST', headers: SEND_HEADERS, body: JSON.stringify(payload) })
            .then((response) => readJsonResponse(response))
            .then((data) => {
              if (!data || !data.ok) throw new Error(data && data.error ? data.error : '上传失败')
              loadKbList()
              setMsg('已加入本地知识库：' + file.name + '（' + (data.value.files || 1) + ' 个文档，' + (data.value.chunks || 0) + ' 段已索引）')
            })
            .catch((error) => setMsg('上传失败：' + String((error && error.message) || error)))
        }
        if (isZip) reader.readAsDataURL(file)
        else reader.readAsText(file)
      }
      const loadImaKbs = (apiKey, clientId) => {
        if (apiKey === '' || clientId === '') { setImaKbs([]); setImaKbError('填写 API Key 与 Client ID 并保存后，才能加载知识库'); return }
        setImaKbLoading(true)
        setImaKbError('')
        fetch(API.imaKbs, { method: 'POST', headers: SEND_HEADERS, body: JSON.stringify({ apiKey, clientId }) })
          .then((response) => readJsonResponse(response))
          .then((data) => {
            if (!data || !data.ok) throw new Error(data && data.error ? data.error : '知识库加载失败')
            const list = Array.isArray(data.value.knowledgeBases) ? data.value.knowledgeBases : []
            setImaKbs(list)
            saveJson('dsh:plugin:fcp:imaKbList', list)
          })
          .catch((error) => setImaKbError(String((error && error.message) || error)))
          .finally(() => setImaKbLoading(false))
      }

      const saveIma = () => {
        const next = { ...config, ima: { apiKey: imaKey.trim(), clientId: imaClient.trim(), configured: imaKey.trim() !== '' } }
        saveJson(CONFIG_KEY, next)
        onSaved(next)
        saveJson('dsh:plugin:fcp:imaExtra', extraKbs)
        syncKbConfig(next, imaKbs)
        setMsg('IMA 配置已保存' + (next.ima.configured ? '' : '（请先填写 API Key）'))
        if (next.ima.apiKey !== '' && next.ima.clientId !== '') loadImaKbs(next.ima.apiKey, next.ima.clientId)
      }
      const loadVaultDir = (path) => {
        setVaultLoading(true)
        setVaultError('')
        fetch(API.fsList + (path ? '?path=' + encodeURIComponent(path) : ''), { cache: 'no-store' })
          .then((response) => readJsonResponse(response))
          .then((data) => {
            if (!data || !data.ok) throw new Error(data && data.error ? data.error : '目录读取失败')
            setVaultPath(data.value.path)
            setVaultEntries(Array.isArray(data.value.entries) ? data.value.entries : [])
          })
          .catch((error) => setVaultError(String((error && error.message) || error)))
          .finally(() => setVaultLoading(false))
      }
      const pickVault = async () => {
        try {
          const picker = ctx.remote && ctx.remote.directoryPicker
          if (picker && typeof picker.pick === 'function') {
            const result = await picker.pick()
            const path = result && result.ok === true ? result.value : result
            if (typeof path === 'string' && path !== '') { setVault(path); setMsg('已选择 Vault：' + path); return }
            if (path === null) return
          }
        } catch (error) {
          console.warn('[fcp] native directory picker unavailable', error)
        }
        openVaultPicker()
      }
      const openVaultPicker = () => {
        setVaultPickerOpen(true)
        loadVaultDir(vault || '')
      }
      const chooseVault = () => {
        if (vaultPath !== '') setVault(vaultPath)
        setVaultPickerOpen(false)
      }

      const saveObsidian = () => {
        const next = { ...config, obsidian: { vault: vault.trim(), configured: vault.trim() !== '' } }
        saveJson(CONFIG_KEY, next)
        onSaved(next)
        syncKbConfig(next, imaKbs)
        setMsg('Obsidian 配置已保存')
      }
      const addModel = () => {
        const name = modelForm.name.trim()
        const id = modelForm.id.trim()
        if (name === '' || id === '') { setMsg('请填写模型名称与 ID，或从预设中选择'); return }
        persistModels(models.concat({ id, name, provider: modelForm.provider.trim() || '自定义', cloud: modelForm.cloud !== false, custom: true, apiKey: modelForm.apiKey.trim(), baseUrl: modelForm.baseUrl.trim() }))
        setModelForm({ name: '', provider: 'DeepSeek', id: '', cloud: true, apiKey: '', baseUrl: '' })
        setAdvancedOpen(false)
        setMsg('已添加模型：' + name)
      }
      const applyPreset = (index) => {
        if (index === '') return
        const preset = MODEL_PRESETS[Number(index)]
        if (preset) setModelForm({ name: preset.name, provider: preset.provider, id: preset.id, cloud: preset.cloud !== false, apiKey: modelForm.apiKey, baseUrl: preset.baseUrl || modelForm.baseUrl })
      }

      let body
      if (tab === 'experts') {
        body = h('div', null,
          h('div', { className: 'sub' }, '内置专家不可卸载；自定义专家通过上传 Markdown 文件新增。'),
          h('input', { ref: expertAddRef, type: 'file', accept: '.md,text/markdown', style: { display: 'none' }, onChange: (event) => { addCustomExpert(event.target.files && event.target.files[0]); event.target.value = '' } }),
          h('div', { className: 'fcp-expert-grid' },
            FALLBACK_EXPERTS.map((expert) => h('div', { key: expert.id, className: 'fcp-expert-card' },
              h('div', { className: 'check' }, '✓'),
              h('b', { style: { fontSize: 14 } }, expert.name),
              h('div', { style: { fontSize: 12, color: 'var(--fcp-text2)', marginTop: 6 } }, expert.summary),
              h('div', { className: 'type' }, '类型：内置')
            )),
            customExperts.map((expert) => h('div', { key: expert.id, className: 'fcp-expert-card' },
              h('div', { className: 'check' }, expert.enabled ? '✓' : '○'),
              h('b', { style: { fontSize: 14 } }, expert.name),
              h('div', { style: { fontSize: 12, color: 'var(--fcp-text2)', marginTop: 6 } }, expert.summary),
              h('div', { className: 'type' }, '类型：自定义'),
              h('button', { type: 'button', className: 'del', onClick: () => persistExperts(customExperts.filter((item) => item.id !== expert.id)) }, '卸载')
            )),
            h('button', { type: 'button', className: 'fcp-add-card', onClick: () => { if (expertAddRef.current) expertAddRef.current.click() } }, h('span', { style: { fontSize: 22 } }, '+'), '添加专家（.md）')
          )
        )
      } else if (tab === 'skills') {
        const catLabel = { 'consumer-protection': '消保', 'office-design': '办公', 'data-tech': '数据', 'compliance-legal': '合规法律', 'marketing': '营销', 'risk-management': '风控', 'research-analysis': '研究分析', 'invest-trading': '投资交易', 'product-business': '产品业务', other: '其他' }
        const fallback = SKILLS.map((item) => ({ id: item[0], name: item[1], desc: item[2], category: 'consumer-protection', source: item[3], installed: true, system: true, version: '', tags: [] }))
          .concat(MARKET_SKILLS.map((item) => ({ id: item[0], name: item[1], desc: item[2], category: 'other', source: item[3], installed: installedIds.includes(item[0]), system: false, version: '', tags: [] })))
        const all = catalogSkills.length > 0 ? catalogSkills : fallback
        const categories = [['all', '全部']].concat(
          catalogCategories.length > 0
            ? catalogCategories.map((cat) => [cat.id, (cat.title && (cat.title.zh || cat.title.en)) || catLabel[cat.id] || cat.id, cat.count])
            : [...new Set(all.map((item) => item.category))].filter((item) => item !== 'all').map((item) => [item, catLabel[item] || item])
        )
        const filtered = all.filter((item) => {
          if (skillView === 'installed' && !(item.system || item.installed)) return false
          if (skillCat !== 'all' && item.category !== skillCat) return false
          if (skillSearch !== '' && !(item.name + item.desc + item.id + (item.tags || []).join(' ')).toLowerCase().includes(skillSearch.toLowerCase())) return false
          return true
        })
        const installedCount = all.filter((item) => item.system || item.installed).length
        const categoryCount = categories.length - 1
        const isLive = catalogMeta && catalogMeta.source === 'network' && !catalogMeta.offline
        const chip = (text) => h('span', { className: 'fcp-chip' }, text)
        body = h('div', null,
          // hero banner：对齐金融技能插件
          h('div', { className: 'fcp-sk-hero' },
            h('img', { src: API.logo, alt: '' }),
            h('div', null,
              h('h2', { className: 'fcp-sk-hero-title' }, '金融行业 Skills 精选'),
              h('p', { className: 'fcp-sk-hero-slogan' }, '把消保岗位的工作流程、要点、技能与知识，打包成随取随用的能力。')
            ),
            h('span', { className: 'fcp-sk-hero-badge' }, categoryCount + ' 类 · ' + all.length + ' 个技能')
          ),
          // meta 行：数据源 / 更新 / 实时状态 / 唯一刷新按钮
          h('div', { className: 'fcp-sk-meta' },
            h('span', null, '数据源：' + ((catalogInfo && catalogInfo.title) || 'openfcp/awesome-financial-skills')),
            h('span', null, '·'),
            h('span', null, '更新 ' + ((catalogInfo && catalogInfo.updated) || '—')),
            h('span', { className: 'tag', style: isLive ? { color: '#188038' } : { color: '#b3261e' } }, isLive ? '实时' : '非实时'),
            h('a', { href: (catalogInfo && catalogInfo.upstreamSite) || 'https://github.com/openfcp/awesome-financial-skills', target: '_blank', rel: 'noreferrer', style: { color: 'var(--fcp-text2)' } }, 'GitHub ↗'),
            h('button', { type: 'button', className: 'fcp-sk-refresh', onClick: () => reloadSkills(true), disabled: skillsLoading }, '↻ ' + (skillsLoading ? '刷新中…' : '刷新'))
          ),
          // 工具栏：搜索 + 全部/已安装
          h('div', { className: 'fcp-sk-toolbar' },
            h('input', { className: 'fcp-sk-search', placeholder: '搜索名称、摘要、标签、作者…', value: skillSearch, onChange: (event) => setSkillSearch(event.target.value) }),
            h('div', { className: 'fcp-seg' },
              h('button', { type: 'button', 'aria-pressed': skillView === 'all', onClick: () => setSkillView('all') }, '全部插件'),
              h('button', { type: 'button', 'aria-pressed': skillView === 'installed', onClick: () => setSkillView('installed') }, '已安装 ' + installedCount)
            )
          ),
          h('hr', { className: 'fcp-hr', style: { margin: '4px 0 12px' } }),
          h('div', { className: 'fcp-sk-cats' }, categories.map((cat) => h('button', { key: cat[0], type: 'button', className: 'fcp-sk-pill', 'aria-pressed': skillCat === cat[0], onClick: () => setSkillCat(cat[0]) }, (cat[1] || '全部') + ' ', h('span', { className: 'fcp-sk-pill-count' }, String(cat[2] !== undefined ? cat[2] : (cat[0] === 'all' ? all.length : all.filter((s) => s.category === cat[0]).length)))))),
          skillError !== '' ? h('div', { className: 'sub', style: { color: '#b3261e' } }, skillError) : null,
          skillsLoading && all.length === 0 ? h('div', { className: 'fcp-empty' }, '正在加载金融技能…') : null,
          h('div', { className: 'fcp-sk-grid' }, filtered.map((item) => {
            const installed = item.system || item.installed
            return h('div', { key: item.id, className: 'fcp-sk-card', 'data-installed': installed ? 'true' : 'false' },
              h('div', { className: 'fcp-sk-card-main' },
                h('div', { className: 'fcp-sk-card-head' },
                  h('button', { type: 'button', className: 'fcp-sk-card-name', onClick: () => openSkillDetail(item) }, item.name),
                  item.nameEn ? h('span', { className: 'fcp-sk-card-en' }, item.nameEn) : null,
                  h('span', { className: 'fcp-sk-card-facts' },
                    h('span', null, '作者 ' + (item.author || '—')),
                    h('span', null, '核验 ' + (item.verifiedAt || '—'))
                  )
                ),
                h('p', { className: 'fcp-sk-card-summary', title: item.desc }, item.desc || '暂无摘要'),
                h('div', { className: 'fcp-sk-card-chips' },
                  chip((categories.find((c) => c[0] === item.category) || [null, item.category])[1] || item.category),
                  chip(item.sourceLabel || '本地'),
                  chip('v' + (item.version || '—')),
                  chip(item.license || '—')
                ),
                installed ? h('div', { className: 'fcp-sk-card-invoke' }, '已安装' + (item.invocationName ? ' · 调用名 ' : '') + (item.invocationName ? h('code', null, item.invocationName) : '')) : null
              ),
              h('div', { className: 'fcp-sk-card-actions' },
                h('button', { type: 'button', className: 'fcp-btn', onClick: () => openSkillDetail(item) }, '详情'),
                item.system ? h('span', { className: 'fcp-sk-fixed' }, '不可删除')
                  : installed ? h('button', { type: 'button', className: 'fcp-btn', disabled: skillBusy === item.id, onClick: () => manageSkill(item, 'uninstall') }, skillBusy === item.id ? '处理中…' : '卸载')
                    : h('button', { type: 'button', className: 'fcp-btn primary', disabled: skillBusy === item.id, onClick: () => manageSkill(item, 'install') }, skillBusy === item.id ? '安装中…' : '安装')
              )
            )
          })),
          h('div', { style: { fontSize: 11, color: 'var(--fcp-text3)', padding: '10px 0' } }, '共 ' + all.length + ' 个 · 已安装 ' + installedCount + ' 个 · 显示 ' + filtered.length + ' 个')
        )
      } else if (tab === 'knowledge') {
        body = h('div', null,
          h('div', { className: 'fcp-kb-sec' },
            h('h3', null, '一、IMA 知识库'),
            // 上半部分：凭证
            h('div', null,
              h('div', { style: { fontSize: 13, lineHeight: 1.8, color: 'var(--fcp-text2)', margin: '6px 0 14px' } },
                '通过 IMA 开放平台获取 API Key 与 Client ID 后，系统即可检索国家法律知识库、八大权益消保知识库，让每条结论有据可依、引用可溯。'),
              h('div', { className: 'fcp-field' }, h('label', null, 'API Key'), h('input', { className: 'fcp-input2', type: 'password', value: imaKey, placeholder: 'IMA API Key', onChange: (event) => setImaKey(event.target.value) })),
              h('div', { className: 'fcp-field' }, h('label', null, 'Client ID'), h('input', { className: 'fcp-input2', value: imaClient, placeholder: 'IMA Client ID', onChange: (event) => setImaClient(event.target.value) })),
              h('div', { className: 'fcp-actions' }, h('button', { type: 'button', className: 'fcp-btn primary', onClick: saveIma }, '保存凭证'))
            ),
            h('hr', { className: 'fcp-hr' }),
            // 下半部分：可选择知识库表格
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('h3', { style: { fontSize: 15, margin: 0, flex: 1 } }, '可选择知识库'),
              h('span', { className: 'fcp-pick-count' }, '已选 ' + extraKbs.length + ' 个'),
              h('button', { type: 'button', className: 'fcp-btn', onClick: () => loadImaKbs(imaKey, imaClient) }, '刷新')
            ),
            h('div', { style: { fontSize: 12, color: 'var(--fcp-text3)', margin: '6px 0' } }, '国家法律知识库、八大权益消保知识库为固定阅读，无需勾选。'),
            imaKbLoading ? h('div', { className: 'sub' }, '正在加载知识库…') : null,
            imaKbError !== '' ? h('div', { className: 'sub', style: { color: '#b3261e' } }, imaKbError) : null,
            !imaKbLoading && imaKbs.length === 0 && imaKbError === '' ? h('div', { className: 'fcp-empty' }, '暂无知识库，保存凭证后会自动加载') : null,
            imaKbs.length > 0 ? h('div', { className: 'fcp-kb-table' }, imaKbs.map((kb, index) => h('label', { key: kb.id || index, className: 'fcp-kb-table-row' },
              h('input', { type: 'checkbox', checked: extraKbs.includes(kb.id), onChange: (event) => setExtraKbs(event.target.checked ? extraKbs.concat(kb.id) : extraKbs.filter((item) => item !== kb.id)) }),
              h('span', { className: 'grow' }, kb.name),
              h('span', { className: 'kb-id' }, kb.id)
            ))) : null,
            h('div', { className: 'fcp-actions' }, h('button', { type: 'button', className: 'fcp-btn primary', onClick: () => { saveJson('dsh:plugin:fcp:imaExtra', extraKbs); saveJson('dsh:plugin:fcp:imaKbList', imaKbs); syncKbConfig(config, imaKbs); window.dispatchEvent(new CustomEvent('fcp:ima-changed')); setMsg('IMA 配置已保存') } }, '保存知识库选择'))
          ),
          h('div', { className: 'fcp-kb-sec' },
            h('h3', null, '二、Obsidian'),
            h('div', { className: 'sub' }, '选择 vault 后保存；首版只读检索。'),
            h('div', { className: 'fcp-field' }, h('label', null, 'Vault 路径（点击选择文件夹）'), h('div', { style: { display: 'flex', gap: 8 } },
              h('input', { className: 'fcp-input2', style: { flex: 1 }, value: vault, readOnly: true, placeholder: '点击选择 Obsidian Vault 文件夹', onClick: pickVault }),
              h('button', { type: 'button', className: 'fcp-btn', onClick: pickVault }, '选择文件夹')
            )),
            h('div', { className: 'fcp-actions' }, h('button', { type: 'button', className: 'fcp-btn primary', onClick: saveObsidian }, '保存 Obsidian 配置'))
          ),
          h('div', { className: 'fcp-kb-sec' },
            h('h3', null, '三、上传知识库'),
            h('div', { className: 'sub' }, '支持 Markdown / zip 知识包，作为本地知识库。'),
            h('input', { ref: kbRef, type: 'file', accept: '.md,.markdown,.zip', style: { display: 'none' }, onChange: (event) => { addKbFile(event.target.files && event.target.files[0]); event.target.value = '' } }),
            h('button', { type: 'button', className: 'fcp-btn', onClick: () => { if (kbRef.current) kbRef.current.click() } }, '上传知识文件'),
            kbFiles.length > 0 ? h('div', { style: { marginTop: 8 } }, kbFiles.map((file) => h('div', { key: file.id, className: 'fcp-skill-row' },
              h('div', { className: 'grow' }, h('b', null, file.name), h('span', null, Math.ceil((file.size || 0) / 1024) + ' KB · ' + new Date(file.at).toLocaleDateString())),
              h('button', { type: 'button', className: 'fcp-btn', onClick: () => removeKb(file.id) }, '删除')
            ))) : null,
            h('div', { className: 'fcp-actions' }, h('button', { type: 'button', className: 'fcp-btn', onClick: () => loadKbList() }, '刷新列表'))
          ),
          msg !== '' ? h('div', { className: 'sub', style: { marginTop: 8 } }, msg) : null
        )
      } else if (tab === 'thinking') {
        body = h('div', null,
          h('div', { className: 'sub' }, '每一种思维方式是一张卡片；上传 Markdown 可新增，卡片会越来越多。'),
          h('input', { ref: thinkingRef, type: 'file', accept: '.md,text/markdown', style: { display: 'none' }, onChange: (event) => { addThinkingFile(event.target.files && event.target.files[0]); event.target.value = '' } }),
          h('div', { className: 'fcp-expert-grid' },
            thinkingCards.map((item) => h('div', { key: item.id, className: 'fcp-expert-card' },
              h('b', { style: { fontSize: 14 } }, item.name),
              h('div', { style: { fontSize: 12, color: 'var(--fcp-text2)', marginTop: 6 } }, item.desc),
              h('div', { className: 'type' }, '版本 ' + (item.version || 'v1') + ' · ' + (item.builtin ? '内置' : '自定义')),
              item.builtin ? null : h('button', { type: 'button', className: 'del', onClick: () => persistThinkingCards(thinkingCards.filter((card) => card.id !== item.id)) }, '删除')
            )),
            h('button', { type: 'button', className: 'fcp-add-card', onClick: () => { if (thinkingRef.current) thinkingRef.current.click() } }, h('span', { style: { fontSize: 22 } }, '+'), '添加思维方式（.md）')
          ),
          msg !== '' ? h('div', { className: 'sub', style: { marginTop: 8 } }, msg) : null
        )
      } else if (tab === 'help') {
        const section = (title, items) => h('div', { className: 'fcp-kb-sec' },
          h('h3', null, title),
          h('ol', { className: 'fcp-help-list' }, items.map((item, index) => h('li', { key: index }, item)))
        )
        body = h('div', null,
          h('div', { className: 'sub' }, '消保工作台基本操作指南 · 按顺序读一遍即可上手'),
          section('一、第一次使用', [
            '在左侧栏打开「消保工作台」，首页会显示六个专家胶囊。',
            '可以直接不选专家，输入任务后发送，系统会按内容自动调度；也可以点一个胶囊手动指定专家。',
            '输入框工具行从左到右：＋（文件/技能）、剪刀（截图）、工作模式（标准/PTC/极简/创造）、模型全名、话筒、发送。右上角三个按钮在 macOS 与 Windows 均可点击。',
            '按 Enter 或点发送按钮，即直接进入对话流程并开始执行，无需二次点击；Shift+Enter 换行。',
          ]),
          section('二、专家配置', [
            '内置专家不可卸载，卡片右上角 ✓ 表示启用。',
            '点「＋ 添加专家（.md）」上传 Markdown 文件，会生成一张自定义专家卡，右下角可卸载。',
            '默认不选专家时，系统按关键词/业务环节自动选择；跨领域任务建议手动指定主专家。',
          ]),
          section('三、技能配置', [
            '界面与「金融技能」插件一致：顶部 banner、数据源/更新时间、唯一红色刷新按钮、搜索、全部/已安装、分类胶囊。',
            '每一行是一条长条卡片，显示中英文名、作者、核验日期、类别/来源/版本/协议胶囊；已安装卡片绿色边框并显示调用名。',
            '点「安装」会把技能真正下载到共享技能目录并立即生效，无需重启；与「金融技能」插件安装的技能互相可见、双向同步。',
            '系统自带技能标「不可删除」；点「详情」查看完整说明。',
          ]),
          section('四、知识配置', [
            'IMA 分上下两部分，中间横线隔开：上半通过 IMA 开放平台获取 API Key 与 Client ID 后填写并保存凭证，系统即可检索国家法律知识库、八大权益消保知识库。',
            '下半「可选择知识库」是表格清单，支持滚动条与勾选，勾选后点「保存知识库选择」；两个库为固定阅读，无需勾选。',
            '点击右上角 IMA 图标，可直接打开更新后的上下两部分配置页。',
            'Obsidian：点 Vault 路径或「选择文件夹」，选目录后点「保存 Obsidian 配置」。',
            '上传知识库：支持 .md / .zip 知识包，上传后立即在本地建立索引，可逐条删除；适合把 rag-kb 这类离线资料手工打包带到你自己的电脑上，随插件配置走，不内置安装。',
            '检索顺序固定为 IMA 知识库 → Obsidian → 上传知识库。回答法规、条款、审查口径等问题前，模型会调用知识检索工具按此顺序查证；三处都未命中时会如实说明「未检索到权威依据」，不编造引用。',
            '这套检索为本插件自有能力，不依赖本机预装的任何 MCP 知识库：换一台电脑，只需重新填 IMA 凭证、绑定 Obsidian 目录或重新上传知识包即可用。凭证只保存在本机，不上传远端。',
          ]),
          section('五、思维配置', [
            '每一种思维方式是一张卡片，显示名称、说明、版本、内置/自定义。',
            '点「＋ 添加思维方式（.md）」上传一个 md，就新增一张卡；自定义卡可删除。',
            '思维方法不再手动选择，由系统按任务自动调配。',
          ]),
          section('六、模型设置', [
            '模型以卡片形式展示，云端模型左下角带云朵图案；「＋ 添加模型」按钮靠右对齐。',
            '添加模型支持下拉选择国内主流模型（DeepSeek、通义千问、豆包、智谱、Kimi、MiniMax、混元等），厂商与基本字段自动带入，缺失字段可自行补充后保存。',
            '点「设为当前」标记当前使用的模型，首页模型选择会同步显示全名。',
          ]),
          section('七、截图与粘贴', [
            '输入框工具行的剪刀：macOS 调用原生框选截图，Windows 及原生失败时退回浏览器截屏，截图会复制到剪贴板并显示缩略图。',
            'macOS 需到「系统设置 → 隐私与安全性 → 屏幕录制」允许 DeepSeek Harness。',
            '也可以先用系统快捷键截图（macOS Shift+Command+4 / Windows Win+Shift+S），再在输入框里粘贴图片（Cmd+V / Ctrl+V）。',
            '缩略图右上角 × 可移除；发送时会把截图文件路径带入任务。',
          ]),
          section('八、常见问题', [
            '提示「接口未就绪（HTTP 404）」：Host 刚更新，需完全退出 DSH 再打开，不能只刷新页面。',
            'IMA 提示「凭证无效或已过期」：重新获取 API Key / Client ID；拉取知识库两个都要填。',
            '技能目录为空：检查网络能否访问 GitHub / jsDelivr，或稍后点「刷新」。',
            '技能安装后立即出现在输入框，无需重启；若未出现，点首页等待数秒会自动同步。',
            '本地配置保存在浏览器 localStorage，技能安装状态保存在共享技能目录 ~/.dsh/skills。',
          ]),
          h('div', { className: 'fcp-kb-sec', style: { marginTop: 16 } },
            h('h3', null, '九、联系与支持'),
            h('div', { style: { fontSize: 13, lineHeight: 1.9, color: 'var(--fcp-text2)' } },
              '使用问题、需求建议或合作事宜，欢迎来信：',
              h('a', { href: 'mailto:support@openfcp.com', style: { color: '#0B57D0' } }, 'support@openfcp.com')
            )
          )
        )
      } else {
        body = h('div', null,
          h('div', { className: 'fcp-add-model-bar' }, h('button', { type: 'button', className: 'fcp-btn primary', onClick: () => setAdvancedOpen(true) }, '+ 添加模型')),
          h('div', { className: 'sub' }, '内置主流云端模型；可添加自定义或本地模型，添加后可在首页模型选择中使用。'),
          h('div', { className: 'fcp-model-cards' }, models.map((item) => h('div', { key: item.id, className: 'fcp-model-card' + (activeModel === item.id ? ' active' : '') },
            h('div', { className: 'fcp-model-head' },
              h('b', { style: { fontSize: 14 } }, modelFullName(item)),
              activeModel === item.id ? h('span', { className: 'tag' }, '当前使用') : null,
              h('div', { style: { marginLeft: 'auto', fontSize: 12, color: 'var(--fcp-text3)' } }, item.provider || '自定义')
            ),
            h('div', { className: 'fcp-model-foot' },
              activeModel === item.id ? null : h('button', { type: 'button', className: 'fcp-btn', onClick: () => { setActiveModel(item.id); saveJson(ACTIVE_MODEL_KEY, item.id) } }, '设为当前'),
              item.custom ? h('button', { type: 'button', className: 'fcp-btn', onClick: () => { const next = models.filter((model) => model.id !== item.id); persistModels(next); if (activeModel === item.id) { setActiveModel(''); saveJson(ACTIVE_MODEL_KEY, '') } } }, '删除') : null
            ),
            item.cloud !== false ? h('div', { className: 'fcp-model-cloud' },
              h('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true' }, h('path', { d: I.cloud })), '云端'
            ) : null
          ))),
          advancedOpen ? h('div', { className: 'fcp-model-card', style: { marginTop: 14 } },
            h('div', { className: 'fcp-model-head' }, h('b', { style: { fontSize: 14 } }, '添加模型')),
            h('div', { className: 'fcp-field' }, h('label', null, '从主流模型预设选择（厂商与基本字段自动带入）'),
              h('select', { className: 'fcp-model-preset', value: '', onChange: (event) => applyPreset(event.target.value) },
                h('option', { value: '' }, '— 自定义 / 请选择 —'),
                MODEL_PRESETS.map((preset, index) => h('option', { key: preset.id, value: String(index) }, preset.name + ' · ' + preset.provider))
              )
            ),
            h('div', { className: 'fcp-model-grid' },
              h('div', { className: 'fcp-field' }, h('label', null, '显示名称'), h('input', { className: 'fcp-input2', value: modelForm.name, onChange: (event) => setModelForm({ ...modelForm, name: event.target.value }) })),
              h('div', { className: 'fcp-field' }, h('label', null, '厂商 / Provider'), h('input', { className: 'fcp-input2', value: modelForm.provider, onChange: (event) => setModelForm({ ...modelForm, provider: event.target.value }) }))
            ),
            h('div', { className: 'fcp-field' }, h('label', null, '模型 ID'), h('input', { className: 'fcp-input2', value: modelForm.id, placeholder: 'deepseek-chat', onChange: (event) => setModelForm({ ...modelForm, id: event.target.value }) })),
            h('div', { className: 'fcp-field' }, h('label', null, 'API Key（仅保存在本机，选填）'), h('input', { className: 'fcp-input2', type: 'password', autoComplete: 'off', value: modelForm.apiKey, placeholder: 'sk-xxxxxxxx', onChange: (event) => setModelForm({ ...modelForm, apiKey: event.target.value }) })),
            h('div', { className: 'fcp-field' }, h('label', null, 'API 地址 / Base URL（选填，预设已自动带入）'), h('input', { className: 'fcp-input2', value: modelForm.baseUrl, placeholder: 'https://api.deepseek.com/v1', onChange: (event) => setModelForm({ ...modelForm, baseUrl: event.target.value }) })),
            h('div', { className: 'sub', style: { fontSize: 11, color: 'var(--fcp-text3)', marginTop: 2 } }, '说明：API 凭证仅存储在本机 localStorage，不上传；选择模型后由 DSH 会话使用。'),
            h('div', { className: 'fcp-model-foot' }, h('button', { type: 'button', className: 'fcp-btn', onClick: () => setAdvancedOpen(false) }, '取消'), h('button', { type: 'button', className: 'fcp-btn primary', onClick: addModel }, '保存'))
          ) : null,
          msg !== '' ? h('div', { className: 'sub', style: { marginTop: 8 } }, msg) : null
        )
      }

      const detailModal = skillDetail === null ? null : h('div', { className: 'fcp-picker', role: 'dialog', 'aria-modal': 'true' },
        h('div', { className: 'fcp-picker-panel' },
          h('div', { className: 'fcp-picker-h' },
            h('b', null, skillDetail.skill.name),
            h('button', { type: 'button', className: 'fcp-iconbtn', 'aria-label': '关闭', onClick: () => setSkillDetail(null) }, '×')
          ),
          skillDetail.loading ? h('div', { className: 'fcp-empty' }, '正在加载详情…') : null,
          skillDetail.error ? h('div', { className: 'sub', style: { color: '#b3261e' } }, skillDetail.error) : null,
          skillDetail.data ? h('div', null,
            h('div', { className: 'fcp-detail-meta' },
              h('span', null, '版本 ' + (skillDetail.data.version || '—')),
              h('span', null, '许可 ' + (skillDetail.data.license || '—')),
              skillDetail.data.author ? h('span', null, '作者 ' + skillDetail.data.author) : null
            ),
            skillDetail.data.summary ? h('div', { className: 'fcp-detail-summary' }, (skillDetail.data.summary.zh || skillDetail.data.summary.en || '')) : null,
            Array.isArray(skillDetail.data.tags) && skillDetail.data.tags.length > 0 ? h('div', { className: 'fcp-detail-tags' }, skillDetail.data.tags.map((tag) => h('span', { key: tag }, '#' + tag))) : null,
            skillDetail.data.markdown ? h('pre', { className: 'fcp-detail-pre' }, skillDetail.data.markdown) : h('div', { className: 'fcp-detail-desc' }, '技能说明：' + (skillDetail.skill.desc || '暂无'))
          ) : null
        )
      )

      const vaultPicker = !vaultPickerOpen ? null : h('div', { className: 'fcp-picker', role: 'dialog', 'aria-modal': 'true' },
        h('div', { className: 'fcp-picker-panel' },
          h('div', { className: 'fcp-picker-h' }, h('b', null, '选择 Obsidian Vault'), h('button', { type: 'button', className: 'fcp-iconbtn', 'aria-label': '关闭', onClick: () => setVaultPickerOpen(false) }, '×')),
          h('div', { className: 'sub', style: { wordBreak: 'break-all' } }, vaultPath || '正在读取…'),
          vaultError !== '' ? h('div', { className: 'sub', style: { color: '#b3261e' } }, vaultError) : null,
          h('div', { className: 'fcp-picker-list' },
            vaultLoading ? h('div', { className: 'fcp-empty' }, '正在读取目录…') : null,
            !vaultLoading && vaultPath !== '' ? h('button', { type: 'button', className: 'fcp-picker-item', onClick: () => loadVaultDir(vaultPath.replace(/\/[^/]+$/, '') || '') }, '.. 上一级') : null,
            vaultEntries.map((entry) => h('button', { key: entry.path, type: 'button', className: 'fcp-picker-item', onClick: () => loadVaultDir(entry.path) }, '📁 ' + entry.name))
          ),
          h('div', { className: 'fcp-picker-f' },
            h('button', { type: 'button', className: 'fcp-btn', onClick: () => setVaultPickerOpen(false) }, '取消'),
            h('button', { type: 'button', className: 'fcp-btn primary', onClick: chooseVault }, '选择此文件夹')
          )
        )
      )

      return h('div', { className: 'fcp-settings' },
        h('div', { className: 'fcp-settings-main' },
          h('div', { className: 'fcp-settings-head' },
            h('button', { type: 'button', className: 'fcp-back', onClick: onBack }, '← 返回工作台'),
            h('h2', { style: { fontSize: 20 } }, '设置')
          ),
          h('div', { className: 'fcp-tabs', role: 'tablist', style: { marginBottom: 18 } },
            tabs.map((item) => h('button', {
              key: item[0], type: 'button', role: 'tab', className: 'fcp-tab',
              'aria-selected': tab === item[0], onClick: () => setTab(item[0]),
            }, item[1]))
          ),
          body
        ),
        detailModal,
        vaultPicker
      )
    }

    exports.inject = ['slots', 'layout', 'remote', 'remote.directoryPicker']

    exports.apply = (ctx) => {
      ctx.effect(() => { injectCss() }, 'fcp: styles')
      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 15,
        label: () => PANEL_LABEL,
      }, PanelIcon)), 'fcp: sidebar entry')
      ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
      }, () => h(PageShell, { ctx }))), 'fcp: page')
      ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'fcp-context',
        order: 40,
      }, (props) => h(FcpDock, { ...props, ctx }))), 'fcp: session dock')
    }

    return module.exports
  },
})
