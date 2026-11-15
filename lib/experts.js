/** 六位专家定义（v0.1：人设 + 技能 + 工作逻辑） */
export const EXPERTS = [
  {
    id: 'policy',
    name: '政策研究',
    summary: '跟踪解读监管新规，判断对本机构的影响面与制度缺口。',
    skills: ['policy-research', 'lieflat-gongwen'],
    body: '流程：先读 IMA 两个固定知识库（国家法律知识库、八大权益消保知识库）→ 五步解读（定位、读原文、辨效力、看口径、算影响）→ 输出条文精读卡 / 影响面分析 / 制度修订清单 / 政策问答。',
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
    skills: ['financial-literacy-education', 'rayskills', 'lieflat-gongwen'],
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
  policy: ['政策', '新规', '法规', '条例', '办法', '解读', '效力', '废止', '制度', '监管要求', '通知', '意见稿', '文件'],
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
