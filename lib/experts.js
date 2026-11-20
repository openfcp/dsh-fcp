/** 六位专家定义（v0.1：人设 + 技能 + 工作逻辑） */
export const EXPERTS = [
  {
    id: 'policy',
    name: '政策研究',
    summary: '跟踪解读监管新规，判断对本机构的影响面与制度缺口。',
    // 只保留远端目录真实存在的技能；policy-research 已从目录消失，写进提示词会让模型加载时报 unknown
    skills: ['official-document-skill', 'lieflat-gongwen'],
    body: '流程：先调用 fcp_search_knowledge 检索 IMA 知识库 → 五步解读（定位、读原文、辨效力、看口径、算影响）→ 输出条文精读卡 / 影响面分析 / 制度修订清单 / 政策问答。',
  },
  {
    id: 'review',
    name: '消保审查',
    summary: '产品、营销素材、协议条款的事前合规审查。',
    skills: ['consumer-protection-review', 'lieflat-gongwen'],
    body: '流程：解析送审材料 → 六维审查与八项权益映射 → 风险定级 → 输出《消保审查意见书》（问题｜原文｜风险等级｜法规依据｜整改建议）。',
  },
  {
    id: 'complaint',
    name: '投诉管理',
    summary: '投诉分析、答复口径、时限跟踪与溯源整改。',
    skills: ['complaint-management', 'lieflat-gongwen'],
    body: '流程：数据口径确认 → 分类打标（JR/T 0169-2018）→ 多维分析（同比/环比/趋势/归因）→ 输出分析报告、答复口径、整改台账；注意 15/30/60 日时限。',
  },
  {
    id: 'education',
    name: '金融教育',
    summary: '宣教策划、材料制作、培训课件与效果评估。',
    skills: ['rayskills', 'lieflat-gongwen'],
    body: '流程：确认对象/渠道/预算 → 活动方案与物料 → 宣传材料合规自检 → 培训课件/考题 → 效果量化评估；可调用 rayskills 产出长文/口播/科普/封面。',
  },
  {
    id: 'general',
    name: '综合管理',
    summary: '体制机制、消保检查、评价考核与协调。',
    skills: ['consumer-protection-inspection', 'consumer-protection-annual-evaluation', 'lieflat-gongwen'],
    body: '流程：制度清单盘点 → 检查计划与执行（六大领域）→ 监管评价自评（七要素）→ 问题整改台账 → 输出自评报告、工作计划、检查报告、考核方案。',
  },
  {
    id: 'sales',
    name: '销售管理',
    summary: '适当性、双录与销售行为、渠道管理。',
    skills: ['compliance-sales', 'lieflat-gongwen'],
    body: '流程：营销宣传八不得/禁用词检查 → 适当性匹配（客户分级 × 产品风险）→ 双录与可回溯检查 → 销售行为监测 → 输出审查意见、适当性报告、双录检查报告。',
  },
]

export function expertById(id) {
  return EXPERTS.find((item) => item.id === id)
}

/** 关键词路由：默认无专家时，按任务文本选出最合适的一位专家。 */
const ROUTE_KEYWORDS = {
  policy: ['政策', '新规', '法规', '条例', '办法', '解读', '效力', '废止', '制度', '监管要求', '通知', '意见稿', '文件', '5号令', '号令', '出台', '背景', '沿革', '历史', '脉络', '修订'],
  review: ['审查', '营销', '宣传', '海报', '文案', '话术', '协议', '条款', '材料', '广告', '物料', '产品说明', '送审'],
  complaint: ['投诉', '工单', '纠纷', '信访', '12378', '超期', '答复', '和解', '调解', '重复投诉', '溯源', '整改'],
  education: ['教育', '宣教', '宣传月', '培训', '课件', '考题', '科普', '活动', '消费者教育', '金融知识'],
  general: ['自评', '评价', '考核', '制度清单', '工作计划', '总结', '委员会', '机制', '检查', '自查', '整改台账', '报告'],
  sales: ['适当性', '双录', '可回溯', '销售行为', '渠道', '合作机构', '风险等级', '客户分级', '信息披露', '代销'],
}

export function routeTask(text) {
  const content = typeof text === 'string' ? text : ''
  const scores = new Map()
  for (const [id, keywords] of Object.entries(ROUTE_KEYWORDS)) {
    let score = 0
    for (const keyword of keywords) if (content.includes(keyword)) score += 1
    if (score > 0) scores.set(id, score)
  }
  let best = null
  for (const [id, score] of scores) {
    if (best === null || score > best.score) best = { id, score }
  }
  if (best === null) return { expertId: 'general', reason: '未命中明确领域，交给综合管理兜底' }
  const expert = EXPERTS.find((item) => item.id === best.id)
  return { expertId: best.id, reason: '命中关键词：' + expert.name, expertName: expert.name }
}

/**
 * 技能关键词路由：与专家路由同构，但一个任务可命中多个技能。
 * 纯文本匹配，不落盘、不依赖宿主，Host / 浏览器两侧只通过 /api/fcp/route-skills 交互。
 * 客户端会把返回的 skillIds 与用户手工勾选的技能取并集（手工在前、去重），
 * 所以这里只负责「按关键词自动挑出相关技能」，不覆盖手工选择。
 */
/** 随插件启用即自动安装的默认技能；每一项都必须在远端技能目录中存在，否则装不上。 */
export const DEFAULT_SKILL_IDS = [
  'consumer-protection-review',
  'complaint-management',
  'rayskills',
  'consumer-protection-inspection',
  'consumer-protection-annual-evaluation',
  'compliance-sales',
  'lieflat-gongwen',
  'official-document-skill',
  'gongwenformat-pro',
]

const SKILL_ROUTE_KEYWORDS = {
  'consumer-protection-review': ['审查', '送审', '营销', '宣传', '海报', '文案', '话术', '协议', '条款', '广告', '物料', '产品说明', '八项权益', '风险定级', '消保审查'],
  'complaint-management': ['投诉', '工单', '纠纷', '信访', '12378', '超期', '答复口径', '和解', '调解', '重复投诉', '溯源', '月报', '分类打标', '整改台账'],
  'rayskills': ['长文', '口播', '封面', '短视频', 'Ray', '内容创作', '科普稿'],
  'consumer-protection-inspection': ['检查', '自查', '迎检', '检查计划', '现场检查', '检查报告', '六大领域'],
  'consumer-protection-annual-evaluation': ['自评', '评价', '考核', '监管评价', '七要素', '失分', '评价指标', '自评报告'],
  'compliance-sales': ['适当性', '双录', '可回溯', '销售行为', '渠道', '合作机构', '风险等级', '客户分级', '代销', '八不得', '信息披露'],
  'lieflat-gongwen': ['躺平公文', '公文味', '公文族', '骨架公式', '经验材料', '党建材料'],
  'official-document-skill': ['公文写作', '起草公文', '起草通知', '公文润色', '润色', '降AI味', '减少AI味', '政务表达', '请示', '批复', '通报', '讲话稿', '汇报材料', '调研报告', '公开信', '政策解读'],
  'gongwenformat-pro': ['公文排版', '红头', 'GB/T 9704', '发文字号', '版记', '发文格式', '转成Word', '生成docx', '排版成Word', '正式文件', '标准格式'],
}

export function routeSkills(text, options = {}) {
  const content = typeof text === 'string' ? text : ''
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : 3
  const matched = []
  for (const [id, keywords] of Object.entries(SKILL_ROUTE_KEYWORDS)) {
    const hits = keywords.filter((keyword) => content.includes(keyword))
    if (hits.length > 0) matched.push({ id, score: hits.length, keywords: hits })
  }
  matched.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  return { skillIds: matched.slice(0, limit).map((item) => item.id), matched: matched.slice(0, limit) }
}
