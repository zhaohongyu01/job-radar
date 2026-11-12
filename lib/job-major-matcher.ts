import type { Job, PositionRequirement } from './jobs.ts';
import { MAJOR_ALIASES, MAJOR_GROUPS, resolveMajorCategories, tokenizeMajorClauses } from './major-groups.ts';

export const UNLIMITED_MAJOR_TOKEN = '专业不限';

export interface MajorMatchOptions {
  includeUnlimited?: boolean;
}

export interface SingleTermMajorProfile {
  summaryHint: string;
  concreteSubstrings: string[];
  concreteExactTokens: string[];
  umbrellaSubstrings: string[];
  umbrellaExactTokens: string[];
  broadUmbrellaSubstrings: string[];
  broadUmbrellaExactTokens: string[];
  offTrackRolePatterns: RegExp[];
  roleKeywords: string[];
  financeSectorRoleKeywords: string[];
}

export interface ResolvedJobMajorProfile {
  active: boolean;
  summaryHint: string;
  concreteSubstrings: string[];
  concreteExactTokens: string[];
  umbrellaSubstrings: string[];
  umbrellaExactTokens: string[];
  broadUmbrellaSubstrings: string[];
  broadUmbrellaExactTokens: string[];
  roleKeywords: string[];
  financeSectorRoleKeywords: string[];
  subProfiles: SingleTermMajorProfile[];
}

interface MajorFamilyRule {
  id: string;
  triggers: readonly string[];
  summaryHint: string;
  concreteSubstrings: readonly string[];
  concreteExactTokens?: readonly string[];
  umbrellaSubstrings: readonly string[];
  umbrellaExactTokens?: readonly string[];
  broadUmbrellaSubstrings?: readonly string[];
  broadUmbrellaExactTokens?: readonly string[];
  offTrackRolePattern?: RegExp;
  roleKeywords: readonly string[];
  financeSectorRoleKeywords?: readonly string[];
}

const FINANCE_ACCOUNTING_OFF_TRACK_ROLE_RE =
  /人力资源|人事|\bhr\b|\bhrbp\b|招聘|薪酬|员工关系|组织发展|培训专员|行政|文秘|秘书|前台|后勤|党群|党建|宣传|市场|营销|品牌|公关|广告|策划|新媒体|文案|编辑|记者|主播|直播|美工|设计|产品策略|产品经理|产品专员|产品运营|用户运营|内容运营|活动运营|电商运营|社群运营|门店运营|销售|渠道|客户代表|客户经理|大客户|商务拓展|\bbd\b|招商|置业顾问|外贸|国际贸易|海外营销|海外销售|跨境|客服|客群服务|话务|导购|店长|门店|采购|物流|供应链|仓储|仓库|物控|关务|单证|法务|律师|研发|软件|算法|前端|后端|测试|运维|硬件|机械|电气|电子|结构|工艺|设备|质量|品质|生产|车间|安全员/;

const ECONOMICS_OFF_TRACK_ROLE_RE =
  /人力资源|人事|\bhr\b|\bhrbp\b|招聘|薪酬|员工关系|组织发展|培训专员|行政|文秘|秘书|前台|后勤|党群|党建|纪检|法务|律师|诉讼|出纳|文案|编辑|记者|新媒体|主播|直播|美工|设计|产品策略|产品经理|用户运营|内容运营|活动运营|客服|客群服务|话务|导购|店长|门店|采购|物流|供应链|仓储|仓库|物控|研发|软件|算法|前端|后端|测试|运维|硬件|机械|电气|电子|结构|工艺|设备|质量|品质|生产|车间/;

const FINANCE_TRACK_OFF_TRACK_ROLE_RE =
  /人力资源|人事|\bhr\b|\bhrbp\b|招聘|薪酬|员工关系|组织发展|培训专员|行政|文秘|秘书|前台|后勤|党群|党建|纪检|法务|律师|诉讼|出纳|文案|编辑|记者|新媒体|主播|直播|美工|设计|产品策略|产品经理|市场推广|品牌|公关|广告|用户运营|内容运营|活动运营|外贸业务|国际贸易销售|货代|报关|单证|客服|客群服务|话务|导购|店长|门店|采购|物流|供应链|仓储|仓库|物控|研发|软件|算法|前端|后端|测试|运维|硬件|机械|电气|电子|结构|工艺|设备|质量|品质|生产|车间/;

const HUMANITIES_OFF_TRACK_ROLE_RE =
  /销售|外贸|国际贸易|跨境|海外营销|海外销售|渠道|客户代表|客户经理|大客户|商务拓展|\bbd\b|招商|置业顾问|理财|信贷|核保|理赔|客服|客群服务|话务|导购|门店|店长|财务|会计|审计|出纳|税务|法务|律师|采购|物流|供应链|仓储|研发|软件|算法|前端|后端|硬件|机械|电气|设备|工艺/;

const MAJOR_FAMILY_RULES: readonly MajorFamilyRule[] = [
  {
    id: 'asset-appraisal',
    triggers: ['资产评估', '评估师', '资产评估学', 'mv'],
    summaryHint: '已关联可投范围：资产评估/财会审计/税务/投资 · 财经/财会/经管类及评估财审投融资岗',
    concreteSubstrings: [
      '资产评估',
      '房地产评估',
      '土地评估',
      '矿业权评估',
      '财务管理',
      '会计',
      '财务会计',
      '财会',
      '审计',
      '税务',
      '税收',
      '财政学',
      '投资学',
      '房地产开发与管理',
    ],
    concreteExactTokens: ['评估', '财务', '财政', '投资'],
    umbrellaSubstrings: ['财经', '财会', '财务类', '财政学类'],
    broadUmbrellaSubstrings: ['经济管理', '经管', '工商管理类', '管理学类', '管理类', '商科'],
    broadUmbrellaExactTokens: ['管理', '管理学', '工商管理'],
    offTrackRolePattern: FINANCE_ACCOUNTING_OFF_TRACK_ROLE_RE,
    roleKeywords: [
      '资产评估',
      '评估师',
      '评估助理',
      '评估专员',
      '评估岗',
      '评估经理',
      '评估项目',
      '价值评估',
      '房地产评估',
      '土地评估',
      '估值',
      '财务',
      '会计',
      '审计',
      '税务',
      '出纳',
      '总账',
      '资金管理',
      '预算管理',
      '财务预算',
      '全面预算',
      '预算会计',
      '成本会计',
      '成本管理',
      '内控',
      '资产管理',
      '大资管',
      '资管岗',
      '资管专员',
      '资管经理',
      '资管部',
      '产权管理',
      '投融资',
      '投资经理',
      '投资专员',
      '投资分析',
      '投资岗',
      '并购',
      '风控',
      '风险管理',
      '授信',
      '信贷',
      '不良资产',
    ],
    financeSectorRoleKeywords: ['综合柜员', '柜员'],
  },
  {
    id: 'accounting-audit',
    triggers: [
      '会计',
      '会计学',
      '财会',
      '财务',
      '财务管理',
      '财务会计',
      '审计',
      '审计学',
      '税务',
      '税收',
      '税收学',
      'cpa',
      'acca',
      'mpacc',
      'maud',
    ],
    summaryHint: '已关联可投范围：会计/财务管理/审计/税务/资产评估 · 财经/财会/经管类及财会审计税务岗',
    concreteSubstrings: [
      '会计',
      '财务管理',
      '财务会计',
      '管理会计',
      '大数据与会计',
      '财会',
      '审计',
      '税务',
      '税收',
      '财政学',
      '资产评估',
      '财务会计教育',
      '注册会计师',
      'cpa',
      'acca',
      'mpacc',
    ],
    concreteExactTokens: ['财务', '财政'],
    umbrellaSubstrings: ['财经', '财会', '财务类', '财政学类'],
    broadUmbrellaSubstrings: ['经济管理', '经管', '工商管理类', '管理学类', '管理类', '商科'],
    broadUmbrellaExactTokens: ['管理', '管理学', '工商管理'],
    offTrackRolePattern: FINANCE_ACCOUNTING_OFF_TRACK_ROLE_RE,
    roleKeywords: [
      '会计',
      '财务',
      '审计',
      '税务',
      '出纳',
      '总账',
      '核算',
      '资金管理',
      '资金结算',
      '资金专员',
      '资金主管',
      '资金岗',
      '司库',
      '预算管理',
      '财务预算',
      '全面预算',
      '预算会计',
      '成本会计',
      '成本核算',
      '成本管理',
      '成本分析',
      '成本控制',
      '内控',
      '风控',
      '风险管理',
      '财务结算',
      '清算结算',
      '结算专员',
      '结算会计',
      '结算岗',
      '应收',
      '应付',
      '资产评估',
      '精算',
      '稽核',
      '投融资',
    ],
    financeSectorRoleKeywords: ['综合柜员', '柜员'],
  },
  {
    id: 'economics-trade',
    triggers: [
      '经济学',
      '经济',
      '理论经济学',
      '应用经济学',
      '国民经济',
      '国民经济管理',
      '区域经济学',
      '产业经济学',
      '数字经济',
      '商务经济学',
      '能源经济',
      '资源与环境经济学',
      '财政',
      '财政学',
      '国际经济与贸易',
      '国际贸易',
      '国贸',
      '贸易经济',
      '国际商务',
      '农林经济管理',
    ],
    summaryHint: '已关联可投范围：理论/应用经济/财政税收/金融投资/国贸 · 经济/财经/经管/商科类及经研金融外贸岗',
    concreteSubstrings: [
      '经济学',
      '国民经济',
      '区域经济',
      '产业经济',
      '劳动经济',
      '数量经济',
      '世界经济',
      '西方经济',
      '政治经济学',
      '资源与环境经济',
      '商务经济',
      '能源经济',
      '数字经济',
      '农林经济',
      '财政学',
      '税收',
      '税务',
      '金融',
      '投资学',
      '保险学',
      '信用管理',
      '经济与金融',
      '国际经济与贸易',
      '国际贸易',
      '经济与贸易',
      '国贸',
      '贸易经济',
      '国际商务',
      '经济统计',
    ],
    concreteExactTokens: ['经济', '财政', '投资', '保险', '贸易'],
    umbrellaSubstrings: [
      '经济类',
      '经济学类',
      '经济相关',
      '经济金融',
      '经济与贸易类',
      '经贸类',
      '财经',
      '金融类',
      '金融学类',
      '财政学类',
    ],
    broadUmbrellaSubstrings: ['经济管理', '经管', '商科', '人文社科', '社科类'],
    broadUmbrellaExactTokens: ['管理', '管理学', '社科'],
    offTrackRolePattern: ECONOMICS_OFF_TRACK_ROLE_RE,
    roleKeywords: [
      '经济研究',
      '宏观研究',
      '行业研究',
      '行研',
      '策略研究',
      '产业研究',
      '政策研究',
      '战略研究',
      '商业分析',
      '经营分析',
      '市场分析',
      '投研',
      '投融资',
      '投资分析',
      '投资经理',
      '投资专员',
      '证券',
      '基金',
      '期货',
      '债券',
      '理财',
      '财富管理',
      '资产管理',
      '风控',
      '风险管理',
      '信贷',
      '授信',
      '国际贸易',
      '外贸',
      '进出口',
      '海外销售',
      '海外营销',
      '跨境电商',
      '单证',
      '关务',
      '商务专员',
      '商务经理',
    ],
    financeSectorRoleKeywords: ['客户经理', '理财经理', '综合柜员', '柜员', '大堂经理'],
  },
  {
    id: 'finance',
    triggers: [
      '金融',
      '金融学',
      '金融工程',
      '金融科技',
      '互联网金融',
      '金融数学',
      '投资学',
      '投资',
      '保险学',
      '保险',
      '信用管理',
      '经济与金融',
      '精算',
      'cfa',
      'frm',
    ],
    summaryHint: '已关联可投范围：金融/金工/金融科技/投资/保险/经济 · 金融/财经/经济/经管类及投研风控银行券商岗',
    concreteSubstrings: [
      '金融',
      '投资学',
      '保险学',
      '精算',
      '信用管理',
      '经济与金融',
      '经济学',
      '应用经济学',
      '产业经济',
      '数字经济',
      '财政学',
      '税收',
      '经济统计',
      '国际经济与贸易',
      'cfa',
      'frm',
    ],
    concreteExactTokens: ['投资', '保险', '经济', '财政'],
    umbrellaSubstrings: [
      '金融类',
      '金融学类',
      '经济金融',
      '经济类',
      '经济学类',
      '财经',
      '财政学类',
    ],
    broadUmbrellaSubstrings: ['经济管理', '经管', '商科'],
    broadUmbrellaExactTokens: ['管理', '管理学'],
    offTrackRolePattern: FINANCE_TRACK_OFF_TRACK_ROLE_RE,
    roleKeywords: [
      '金融',
      '投研',
      '行业研究',
      '行研',
      '宏观研究',
      '策略研究',
      '证券',
      '基金',
      '债券',
      '期货',
      '衍生品',
      '投行',
      '承销',
      '财富管理',
      '理财',
      '资产管理',
      '大资管',
      '资管岗',
      '资管专员',
      '资管经理',
      '资管部',
      '投融资',
      '投资经理',
      '投资专员',
      '投资顾问',
      '投资分析',
      '并购',
      '风控',
      '风险管理',
      '信贷',
      '授信',
      '核保',
      '理赔',
      '精算',
      '资金交易',
      '交易员',
      '外汇',
    ],
    financeSectorRoleKeywords: ['客户经理', '理财经理', '综合柜员', '柜员', '大堂经理', '营业部'],
  },
  {
    id: 'management-broad',
    triggers: ['管理', '管理学', '管理类', '管理学类', '工商管理', '工商管理类', '企业管理', '管理科学', '经管', '经济管理'],
    summaryHint: '已关联可投范围：工商/企管/人力/行政/公管/营销/物流/信管 · 经管/管理类及管培人力行政运营供应链岗',
    concreteSubstrings: [
      '工商管理',
      '企业管理',
      '管理科学',
      '人力资源',
      '行政管理',
      '公共管理',
      '公共事业管理',
      '劳动与社会保障',
      '劳动关系',
      '市场营销',
      '国际商务',
      '商务管理',
      '零售业管理',
      '物流管理',
      '物流工程',
      '供应链管理',
      '采购管理',
      '信息管理',
      '信息资源管理',
      '大数据管理',
      '工程管理',
      '项目管理',
      '文化产业管理',
      '旅游管理',
      '酒店管理',
      '会展经济与管理',
      '档案学',
      '保密管理',
      '应急管理',
      '城市管理',
      '土地资源管理',
      '农林经济管理',
      '物业管理',
      '财务管理',
      '会计',
      '审计',
      '资产评估',
      'mba',
      'mpa',
    ],
    concreteExactTokens: ['管理', '管理学', '营销', '物流', '供应链'],
    umbrellaSubstrings: [
      '管理类',
      '管理学类',
      '工商管理类',
      '公共管理类',
      '管理科学与工程类',
      '物流管理与工程类',
      '工业工程类',
      '经济管理',
      '经管',
      '商科',
    ],
    broadUmbrellaSubstrings: ['财经', '人文社科', '社科类'],
    broadUmbrellaExactTokens: ['社科'],
    offTrackRolePattern:
      /法务|律师|诉讼|记者|采编|编导|翻译|口译|笔译|语文|英语教师|历史教师|政治教师|美工|设计|研发|软件|算法|硬件/,
    roleKeywords: [
      '管培生',
      '管理培训生',
      '储备干部',
      '综合管理',
      '企业管理',
      '企管',
      '经营管理',
      '战略管理',
      '战略发展',
      '行政专员',
      '行政主管',
      '行政助理',
      '行政管理',
      '行政人事',
      '行政文员',
      '行政/人事',
      '办公室专员',
      '办公室文员',
      '综合办',
      '总裁助理',
      '总经理助理',
      '人力资源',
      '人事专员',
      '人事主管',
      '人事助理',
      '人事经理',
      'hrbp',
      '招聘专员',
      '薪酬绩效',
      '组织发展',
      '员工关系',
      '培训专员',
      '运营管理',
      '运营专员',
      '商业运营',
      '用户运营',
      '产品运营',
      '活动运营',
      '门店运营',
      '项目管理',
      '项目专员',
      '采购专员',
      '采购管理',
      '采购经理',
      '供应链',
      '物流专员',
      '物流管理',
      '市场营销',
      '市场策划',
      '品牌策划',
      '销售管培生',
      '党群',
      '党建',
    ],
  },
  {
    id: 'hr-management',
    triggers: ['人力资源', '人力资源管理', '劳动与社会保障', '劳动关系'],
    summaryHint: '已关联可投范围：人力资源/劳动保障/工商管理/行政管理 · 管理/经管/公管类及HR招聘薪酬行政管培岗',
    concreteSubstrings: [
      '人力资源',
      '劳动与社会保障',
      '劳动关系',
      '工商管理',
      '企业管理',
      '行政管理',
      '公共管理',
      '公共事业管理',
      '应用心理学',
      '心理学',
    ],
    umbrellaSubstrings: ['工商管理类', '公共管理类', '管理类', '管理学类'],
    umbrellaExactTokens: ['管理', '管理学'],
    broadUmbrellaSubstrings: ['经济管理', '经管', '人文社科', '社科类', '商科'],
    offTrackRolePattern:
      /财务|会计|审计|出纳|税务|资产评估|投研|行研|证券|基金|信贷|授信|销售|外贸|国际贸易|跨境|采购|物流|供应链|仓储|产品策略|产品经理|市场推广|广告|法务|律师|研发|软件|算法|硬件/,
    roleKeywords: [
      '人力资源',
      '人事',
      'hr',
      'hrbp',
      '招聘',
      '薪酬',
      '绩效',
      '组织发展',
      '员工关系',
      '培训专员',
      '人才发展',
      '企业文化',
      '行政人事',
      '行政专员',
      '综合管理',
      '管培生',
      '管理培训生',
    ],
  },
  {
    id: 'public-admin',
    triggers: ['行政管理', '公共管理', '公共事业管理', '城市管理', '应急管理', '土地资源管理'],
    summaryHint: '已关联可投范围：行政管理/公共管理/劳动保障/工商管理 · 公管/管理/社科类及行政综合党群管培岗',
    concreteSubstrings: [
      '行政管理',
      '公共管理',
      '公共事业管理',
      '劳动与社会保障',
      '土地资源管理',
      '城市管理',
      '应急管理',
      '公共关系学',
      '政治学与行政学',
      '工商管理',
      '企业管理',
      '档案学',
      '秘书学',
      'mpa',
    ],
    umbrellaSubstrings: ['公共管理类', '工商管理类', '管理类', '管理学类'],
    umbrellaExactTokens: ['管理', '管理学'],
    broadUmbrellaSubstrings: ['经济管理', '经管', '人文社科', '社科类'],
    broadUmbrellaExactTokens: ['文科'],
    offTrackRolePattern:
      /财务|会计|审计|出纳|税务|投研|证券|销售|外贸|国际贸易|跨境|采购|物流|供应链|仓储|产品策略|产品经理|广告|研发|软件|算法|硬件/,
    roleKeywords: [
      '行政',
      '综合管理',
      '办公室',
      '综合办',
      '文秘',
      '秘书',
      '党群',
      '党建',
      '党务',
      '纪检',
      '工会',
      '后勤管理',
      '人事行政',
      '人力资源',
      '管培生',
      '管理培训生',
      '社区工作者',
      '社区管理',
    ],
  },
  {
    id: 'logistics-supply-chain',
    triggers: ['物流', '物流管理', '物流工程', '供应链', '供应链管理', '采购管理'],
    summaryHint: '已关联可投范围：物流管理/物流工程/供应链/采购/工业工程 · 物流/管理/经管类及供应链采购仓储计划岗',
    concreteSubstrings: [
      '物流管理',
      '物流工程',
      '供应链管理',
      '采购管理',
      '交通运输',
      '交通管理',
      '工业工程',
      '工商管理',
      '电子商务',
      '国际经济与贸易',
      '信息管理与信息系统',
    ],
    concreteExactTokens: ['物流', '供应链'],
    umbrellaSubstrings: ['物流管理与工程类', '物流类', '管理科学与工程类'],
    broadUmbrellaSubstrings: ['工商管理类', '管理类', '管理学类', '经济管理', '经管'],
    broadUmbrellaExactTokens: ['管理', '管理学'],
    offTrackRolePattern:
      /人力资源|人事|\bhr\b|招聘|行政|文秘|党群|法务|财务|会计|审计|出纳|税务|新媒体|文案|记者|主播|产品策略|研发|软件|算法|硬件/,
    roleKeywords: [
      '物流',
      '供应链',
      '采购',
      '仓储管理',
      '仓库主管',
      '计划专员',
      '计划员',
      '物控',
      'pmc',
      '关务',
      '报关',
      '货运',
      '调度',
      '运营管培生',
      '管培生',
    ],
  },
  {
    id: 'marketing',
    triggers: ['市场营销', '营销'],
    summaryHint: '已关联可投范围：市场营销/工商管理/国际商务/电子商务 · 工商管理/经管/商科类及市场策划品牌销售运营岗',
    concreteSubstrings: [
      '市场营销',
      '工商管理',
      '国际商务',
      '商务管理',
      '电子商务',
      '零售业管理',
      '广告学',
      '传播学',
      '国际经济与贸易',
    ],
    concreteExactTokens: ['营销', '市场'],
    umbrellaSubstrings: ['经济与贸易类'],
    broadUmbrellaSubstrings: ['工商管理类', '管理类', '管理学类', '经济管理', '经管', '商科'],
    broadUmbrellaExactTokens: ['管理', '管理学'],
    offTrackRolePattern:
      /人力资源|人事|\bhr\b|招聘|行政|文秘|党群|法务|财务|会计|审计|出纳|税务|采购|物流|仓储|研发|软件|算法|硬件/,
    roleKeywords: [
      '市场营销',
      '市场专员',
      '市场策划',
      '市场推广',
      '品牌',
      '公关',
      '渠道',
      '销售',
      '大客户',
      '客户经理',
      '商务拓展',
      'bd',
      '电商运营',
      '新媒体运营',
      '用户运营',
      '管培生',
      '管理培训生',
    ],
  },
  {
    id: 'law',
    triggers: ['法学', '法律', '民商法', '经济法', '刑法', '诉讼法', '国际法', '知识产权', '纪检监察', '法硕', '法律硕士'],
    summaryHint: '已关联可投范围：法学/法律/知识产权/民商经济法/纪检监察 · 法学/政法类及法务合规风控纪检岗',
    concreteSubstrings: [
      '法学',
      '民商法',
      '经济法',
      '刑法',
      '宪法',
      '行政法',
      '诉讼法',
      '国际法',
      '国际经济法',
      '环境与资源保护法',
      '社会法',
      '知识产权',
      '国际经贸规则',
      '信用风险管理与法律防控',
      '法律合规',
      '纪检监察',
      '监狱学',
      '司法警察学',
      '社区矫正',
      '法律硕士',
      '法律事务',
      '法硕',
    ],
    concreteExactTokens: ['法律', '法'],
    umbrellaSubstrings: ['法学类', '法律类', '法律相关', '政法'],
    broadUmbrellaSubstrings: ['人文社科', '社科类'],
    broadUmbrellaExactTokens: ['社科'],
    offTrackRolePattern:
      /销售|营销|市场|品牌|公关|广告|产品策略|产品经理|运营|新媒体|文案|编辑|主播|直播|客服|客群服务|话务|外贸|国际贸易|跨境|采购|物流|供应链|仓储|财务|会计|审计|出纳|税务|研发|软件|算法|硬件|设计|美工|门店|导购/,
    roleKeywords: [
      '法务',
      '法律顾问',
      '合规',
      '诉讼',
      '仲裁',
      '律师',
      '知识产权',
      '专利代理',
      '商标',
      '版权',
      '合同管理',
      '合同审核',
      '法审',
      '法律风控',
      '风控法务',
      '纪检',
      '监察',
      '稽核',
      '清收',
      '资产保全',
      '财产保全',
      '诉讼保全',
      '法律保全',
    ],
  },
  {
    id: 'chinese-literature',
    triggers: ['汉语言', '汉语言文学', '中文', '中国语言文学', '汉语国际教育', '对外汉语', '古典文献学', '应用语言学', '秘书学', '文秘'],
    summaryHint: '已关联可投范围：汉语言文学/中文/文秘/新闻传播 · 中文/文史/人文社科类及文秘公文宣传新媒体教研岗',
    concreteSubstrings: [
      '汉语言',
      '中国语言文学',
      '汉语国际教育',
      '对外汉语',
      '中国少数民族语言文学',
      '古典文献',
      '应用语言学',
      '秘书学',
      '文秘',
      '新闻',
      '传播学',
      '广播电视',
      '编辑出版',
      '网络与新媒体',
      '新媒体',
      '历史学',
      '哲学',
    ],
    concreteExactTokens: ['中文', '文学'],
    umbrellaSubstrings: ['中国语言文学类', '中文类', '文史', '新闻传播'],
    broadUmbrellaSubstrings: ['人文社科', '人文类', '社科类', '文科'],
    broadUmbrellaExactTokens: ['人文', '社科', '文科'],
    offTrackRolePattern: HUMANITIES_OFF_TRACK_ROLE_RE,
    roleKeywords: [
      '文秘',
      '秘书',
      '公文',
      '文字综合',
      '综合文字',
      '文案',
      '宣传',
      '品牌宣传',
      '企业文化',
      '新媒体',
      '内容运营',
      '编辑',
      '记者',
      '采编',
      '党群',
      '党建',
      '党务',
      '办公室专员',
      '办公室文员',
      '行政文员',
      '语文教师',
      '语文老师',
      '高中语文',
      '初中语文',
      '小学语文',
    ],
  },
  {
    id: 'journalism-media',
    triggers: ['新闻', '新闻学', '传播学', '新闻传播', '广播电视学', '广告学', '编辑出版学', '网络与新媒体', '新媒体'],
    summaryHint: '已关联可投范围：新闻/传播/广电/广告/新媒体/中文 · 新闻传播/中文/人文社科类及新媒体品牌编导文案岗',
    concreteSubstrings: [
      '新闻',
      '传播学',
      '时尚传播',
      '广播电视',
      '广告学',
      '编辑出版',
      '数字出版',
      '网络与新媒体',
      '新媒体',
      '数字媒体艺术',
      '播音与主持',
      '戏剧影视文学',
      '广播电视编导',
      '汉语言',
      '秘书学',
    ],
    concreteExactTokens: ['中文', '文学', '传播', '广告', '编导'],
    umbrellaSubstrings: ['新闻传播', '传媒类', '中国语言文学类', '中文类', '文史'],
    broadUmbrellaSubstrings: ['人文社科', '社科类', '文科'],
    broadUmbrellaExactTokens: ['人文', '社科', '文科'],
    offTrackRolePattern: HUMANITIES_OFF_TRACK_ROLE_RE,
    roleKeywords: [
      '新媒体',
      '内容运营',
      '文案',
      '编辑',
      '记者',
      '采编',
      '宣传',
      '品牌',
      '公关',
      '媒介',
      '编导',
      '短视频',
      '直播运营',
      '活动策划',
      '舆情',
    ],
  },
  {
    id: 'computer-software',
    triggers: [
      '计算机',
      '计算机科学与技术',
      '软件工程',
      '软件',
      '网络工程',
      '信息安全',
      '网络空间安全',
      '物联网工程',
      '数字媒体技术',
      '智能科学与技术',
      '数据科学与大数据技术',
      '大数据',
      '人工智能',
      '空间信息与数字技术',
      '电子与计算机工程',
    ],
    summaryHint: '已关联可投范围：计算机/软工/人工智能/大数据/网安/物联网/电子信息 · 计算机/信息科技类及研发算法数据安全岗',
    concreteSubstrings: [
      '计算机',
      '软件工程',
      '网络工程',
      '信息安全',
      '网络空间安全',
      '网络安全',
      '物联网',
      '数字媒体技术',
      '智能科学与技术',
      '数据科学与大数据',
      '大数据',
      '人工智能',
      '空间信息与数字技术',
      '电子与计算机工程',
      '信息与计算科学',
      '数据计算及应用',
      '信息管理与信息系统',
      '电子信息',
      '通信工程',
    ],
    concreteExactTokens: ['软件', 'ai', 'cs', 'se', 'it'],
    umbrellaSubstrings: ['计算机类', '计算机相关', '软件类', '电子信息类', '信息科技', '信息技术', '信息类'],
    roleKeywords: [
      '软件开发',
      '软件工程',
      '前端',
      '后端',
      '全栈',
      'java',
      'python',
      'golang',
      'c++',
      '.net',
      '算法',
      '人工智能',
      '大模型',
      '机器学习',
      '深度学习',
      '视觉算法',
      '自然语言处理',
      '测试开发',
      '软件测试',
      '运维',
      'devops',
      'sre',
      '网络安全',
      '信息安全',
      '渗透测试',
      '数据开发',
      '大数据',
      '数据分析',
      '数据挖掘',
      '数据库',
      '信息化',
      '系统开发',
      '系统架构',
      'it支持',
      'it工程师',
      '信息科技',
      '移动端',
      'android',
      'ios',
      '鸿蒙',
      '嵌入式软件',
      '程序员',
    ],
  },
  {
    id: 'electronics-comm',
    triggers: [
      '电子信息',
      '电子信息工程',
      '电子科学与技术',
      '通信工程',
      '通信',
      '微电子',
      '微电子科学与工程',
      '集成电路',
      '集成电路设计与集成系统',
      '光电信息科学与工程',
      '信息工程',
      '电子信息科学与技术',
    ],
    summaryHint: '已关联可投范围：电子信息/通信/微电子/集成电路/光电/自动化/计算机 · 电子信息/电气信息类及嵌入式硬件芯片通信岗',
    concreteSubstrings: [
      '电子信息',
      '电子科学',
      '通信工程',
      '信息与通信',
      '微电子',
      '集成电路',
      '光电信息',
      '光电工程',
      '光学工程',
      '信息工程',
      '电信工程',
      '电磁场与无线技术',
      '电波传播',
      '电子封装',
      '电子与计算机',
      '物联网',
      '自动化',
      '测控技术与仪器',
      '计算机',
      '软件工程',
      '人工智能',
    ],
    concreteExactTokens: ['电子', '通信', '光电', '芯片', 'ic'],
    umbrellaSubstrings: ['电子信息类', '电子类', '通信类', '电气信息类', '信息科技', '信息技术', '信息类', '计算机类'],
    roleKeywords: [
      '嵌入式',
      '硬件',
      'fpga',
      'ic设计',
      '芯片',
      '版图',
      '验证工程师',
      '射频',
      '天线',
      '通信工程师',
      '信号处理',
      'dsp',
      'pcb',
      '电子工程师',
      '单片机',
      '固件',
      '驱动开发',
      '物联网',
      '光电',
      '光学工程师',
      '测试工程师',
    ],
  },
  {
    id: 'electrical-automation',
    triggers: ['电气', '电气工程', '电气工程及其自动化', '智能电网', '电力系统', '自动化', '机器人工程', '测控技术与仪器'],
    summaryHint: '已关联可投范围：电气工程/电力系统/智能电网/自动化/控制/机电 · 电气/自动化/能源动力类及电气继保电控PLC设备岗',
    concreteSubstrings: [
      '电气',
      '电力系统',
      '高电压',
      '电机与电器',
      '电力电子',
      '智能电网',
      '供用电',
      '输配电',
      '光源与照明',
      '自动化',
      '控制科学与工程',
      '控制工程',
      '轨道交通信号与控制',
      '机器人工程',
      '智能装备',
      '测控技术与仪器',
      '仪器科学与技术',
      '机电一体化',
      '机械电子',
      '建筑电气',
      '新能源科学与工程',
      '储能科学与工程',
    ],
    concreteExactTokens: ['电力', '强电', '电控', '测控'],
    umbrellaSubstrings: ['电气类', '电力类', '自动化类', '机电类', '电气信息类', '能源动力类'],
    roleKeywords: [
      '电气',
      '电力',
      '继电保护',
      '变电',
      '输电',
      '配电',
      '电网',
      '电控',
      'plc',
      '电机',
      '自动化工程师',
      '自控',
      '仪控',
      '储能',
      '光伏',
      '风电',
      '新能源工程师',
      '硬件工程师',
      '嵌入式',
      '机电工程师',
      '设备工程师',
    ],
  },
  {
    id: 'mechanical-vehicle',
    triggers: [
      '机械',
      '机械工程',
      '机械设计制造及其自动化',
      '机械电子工程',
      '机电',
      '材料成型及控制工程',
      '车辆工程',
      '智能制造工程',
      '过程装备与控制工程',
      '工业设计',
    ],
    summaryHint: '已关联可投范围：机械工程/机械设计/机电/车辆工程/材料成型/智能制造 · 机械/装备制造类及结构工艺研发设备质量岗',
    concreteSubstrings: [
      '机械',
      '材料成型',
      '过程装备',
      '车辆工程',
      '新能源汽车工程',
      '智能车辆',
      '汽车工程',
      '汽车服务工程',
      '智能制造',
      '工业设计',
      '工业工程',
      '机电一体化',
      '测控技术与仪器',
      '机器人工程',
      '自动化',
      '能源与动力工程',
      '飞行器制造',
      '船舶与海洋工程',
      '农业机械',
      '模具设计与制造',
      '数控技术',
      '焊接技术',
    ],
    concreteExactTokens: ['机电', '车辆', '汽车', '模具', '数控', '焊接'],
    umbrellaSubstrings: ['机械类', '机械工程类', '机电类', '汽车及智能制造类', '装备制造', '车辆类', '自动化类'],
    roleKeywords: [
      '机械',
      '结构工程师',
      '结构设计',
      '工艺工程师',
      '机械工程师',
      '机电工程师',
      '夹具',
      '模具',
      '焊接',
      '冲压',
      '涂装',
      '总装',
      '底盘',
      '车身',
      '动力总成',
      'nvh',
      'cae',
      'cad',
      '数控',
      'cnc',
      '设备工程师',
      '设备技术员',
      '机械技术员',
      '液压',
      '装调',
      '智能制造',
      'ie工程师',
      '质量工程师',
      'sqe',
    ],
  },
  {
    id: 'civil-construction',
    triggers: ['土木', '土木工程', '工程造价', '工程管理', '建筑学', '城乡规划', '给排水', '水利', '道路桥梁'],
    summaryHint: '已关联可投范围：土木/道桥/给排水/建环/工程管理/工程造价/水利 · 土木/建筑/水利类及施工结构造价工程管理岗',
    concreteSubstrings: [
      '土木工程',
      '建筑环境与能源应用',
      '给排水',
      '建筑电气与智能化',
      '城市地下空间',
      '道路桥梁',
      '交通工程',
      '智能建造',
      '工程管理',
      '工程造价',
      '建筑学',
      '城乡规划',
      '风景园林',
      '水利水电',
      '水利工程',
      '水文与水资源',
      '港口航道',
      '市政工程',
      '安全工程',
      '测绘工程',
    ],
    concreteExactTokens: ['土木', '建筑', '造价', '水利', '道桥', '市政', '测绘'],
    umbrellaSubstrings: ['土木类', '建筑类', '水利类', '土建类', '工程管理类', '测绘类'],
    roleKeywords: [
      '土木',
      '土建',
      '施工员',
      '施工管理',
      '结构设计',
      '建筑设计',
      '工程造价',
      '预算员',
      '造价员',
      '成本合约',
      '商务管理岗',
      '工程管理',
      '监理',
      '测量员',
      '给排水',
      '暖通',
      '市政',
      '路桥',
      '水利',
    ],
  },
  {
    id: 'foreign-language',
    triggers: ['英语', '商务英语', '翻译', '外语', '外国语言文学', '日语', '俄语', '法语', '德语', '西班牙语', '阿拉伯语', '韩语', '朝鲜语'],
    summaryHint: '已关联可投范围：英语/商务英语/翻译/小语种/国际商务 · 外国语言文学/外语/经贸类及外贸海外销售翻译教研岗',
    concreteSubstrings: [
      '英语',
      '商务英语',
      '翻译',
      '外国语言文学',
      '外语',
      '日语',
      '俄语',
      '法语',
      '德语',
      '西班牙语',
      '阿拉伯语',
      '朝鲜语',
      '韩语',
      '葡萄牙语',
      '意大利语',
      '国际商务',
      '国际经济与贸易',
    ],
    umbrellaSubstrings: ['外国语言文学类', '外语类', '语言类'],
    broadUmbrellaSubstrings: ['人文社科', '文科'],
    broadUmbrellaExactTokens: ['文科'],
    offTrackRolePattern:
      /财务|会计|审计|出纳|税务|法务|律师|语文教师|历史教师|政治教师|党群|党建|纪检|研发|软件|算法|硬件/,
    roleKeywords: [
      '翻译',
      '口译',
      '笔译',
      '英语',
      '外语',
      '外贸',
      '海外销售',
      '海外营销',
      '海外市场',
      '海外客户',
      '国际业务',
      '跨境电商',
      '外事',
      '出国留学',
    ],
  },
];

const KNOWN_ACADEMIC_MAJORS = new Set<string>(
  [
    ...Object.keys(MAJOR_GROUPS),
    ...Object.values(MAJOR_GROUPS).flat(),
    ...Object.keys(MAJOR_ALIASES),
    ...Object.values(MAJOR_ALIASES).flat(),
  ].map((s) => s.toLowerCase()),
);

const DISQUALIFYING_MAJOR_TOKEN_RE =
  /能力|经验|知识(?!产权)|技能|水平|精神|态度|素质|素养|意识|责任|热爱|熟悉|掌握|精通|了解|熟练|具备|具有|能够|良好|较强|优秀|身体|健康|年龄|周岁|性别|户籍|工作地|地点|服从|接受|出差|倒班|实习|薪资|待遇|福利|五险|双休|补贴|住宿|证书|资格证|考试|认证|执业|职称|职责|描述|内容|贯彻|落实|遵守|法律法规|规章制度|招聘|简章|公司|集团|企业|单位|部门|人数|名额|序号|备注|联系方式|电话|邮箱|网址|报名|投递|面试|笔试|条件|岗位|职位|我们|希望|如果|你是|来自|只要|浓厚|兴趣|从事|工作|业务范围|涵盖|扎实|通过|部分|方向$|以上|以下|左右|不限/;

const JOB_ROLE_NOT_MAJOR_SUFFIX_RE =
  /(?:工程师|经理|主管|总监|主任|技术员|办事员|柜员|专员|助理|顾问|代表|营销服务|开发岗|管理岗)$/;

const ACADEMIC_DISCIPLINE_STEM_RE =
  /(?:计算机|软件|网络|物联网|大数据|数据科学|人工智能|智能科学|信息安全|网安|空间信息|数字媒体|电子|通信|微电子|集成电路|光电|光学|电信|电磁|自动化|机器人|测控|仪器|控制科学|控制工程|电气|电力|智能电网|电机|光源|储能|新能源|能源|动力|核工程|核技术|机械|车辆|汽车|材料成型|过程装备|智能制造|工业设计|工业工程|机电|模具|数控|焊接|飞行器|航空|航天|船舶|海洋工程|兵器|武器|土木|建筑|城乡规划|风景园林|给排水|水利|水电|水文|港口|航道|道路桥梁|道桥|市政|智能建造|交通|运输|航海|轮机|测绘|遥感|地理信息|地质|采矿|矿业|石油|油气|安全工程|消防|应急|材料|冶金|金属|高分子|无机非金属|复合材料|化学|化工|应用化学|制药|化学生物|生物|生命科学|生物技术|生物工程|生物医学|生态|环境|资源|气象|大气|海洋科学|地球物理|数学|数理|信息与计算|统计|物理|应用物理|力学|天文|心理|应用心理|经济|财政|税收|税务|金融|投资|保险|精算|信用管理|国际商务|国贸|贸易|工商管理|企业管理|管理科学|市场营销|营销|会计|财会|财务|审计|资产评估|评估|工程管理|工程造价|造价|项目管理|人力资源|行政管理|公共管理|公共事业|劳动与社会保障|劳动关系|土地资源|城市管理|海关管理|海事管理|文化产业|物业管理|物流|供应链|采购|信息管理|信息资源|档案|图书馆|情报|保密|电子商务|电商|旅游管理|酒店管理|会展|农林经济|法学|法律|知识产权|民商法|经济法|刑法|诉讼法|国际法|纪检监察|监狱学|政法|汉语言|中文|中国语言|汉语国际|对外汉语|古典文献|应用语言|秘书|文秘|新闻|传播|广播电视|广告|编辑出版|新媒体|播音|编导|戏剧|影视|音乐|舞蹈|美术|绘画|雕塑|摄影|书法|动画|视觉传达|环境设计|产品设计|服装设计|艺术|英语|俄语|德语|法语|西班牙语|阿拉伯语|日语|朝鲜语|韩语|翻译|外语|外国语言|历史|考古|文物|博物馆|哲学|逻辑学|宗教学|政治学|国际政治|外交学|社会学|社会工作|人类学|民族学|马克思主义|党史|思想政治|教育学|科学教育|人文教育|学前教育|小学教育|特殊教育|体育|运动|武术|临床医学|口腔医学|预防医学|公共卫生|中医学|针灸推拿|中西医|基础医学|法医学|麻醉学|医学影像|眼视光|精神医学|放射医学|儿科学|康复治疗|医学检验|医学实验|卫生检验|护理|助产|药学|药物|临床药学|中药学|农学|园艺|植物保护|植保|种子|设施农业|茶学|烟草|林学|园林|森林|水产|动物科学|动物医学|畜牧|兽医|草学|食品|轻工|包装|印刷|纺织|服装设计与工程|宝石|商科|财经|经管|文史|理工|工科|理科|文科|社科|人文|师范|医科|医药|农林)/i;

const GENERIC_CATEGORY_PREFIX_RE = /^(?:各|本|该|其他|其它|相关|上述|以上|对应|对口|所学|招聘|需求|部分|全部|不限|任意|指定|重点|热门)$/;

const UNLIMITED_INLINE_RE =
  /(?:专业不限|不限专业|不限所学专业|无专业限制|(?:专业要求|需求专业|所学专业|招聘专业|专业范围|专业类别|专业条件|专业)\s*[:：]\s*(?:不限|无限制|均可|不限专业|专业不限)(?=$|[\s，,。；;（()）\n]))/;

const INLINE_MAJOR_LABEL_RE =
  /(?:^|[\n；;。！!？?｜|•·*◆●])\s*(?:\(?[一二三四五六七八九十\d]+[、.．)）]\s*)?【?\s*(?:专业要求|需求专业|所学专业|招聘专业|专业范围|专业方向|专业类别|学科专业|专业条件|专业背景|对口专业|专业)\s*】?\s*(?:[:：]|(?:为|是|限|包括)(?![^\n。；;]{0,6}[:：]))\s*([^\n。！!？?]{2,180})/g;

const MULTILINE_MAJOR_BLOCK_RE =
  /(?:^|\n)\s*[*◆●•·-]?\s*(?:【\s*(?:校招岗位及)?(?:专业要求|需求专业|所学专业|招聘专业|专业范围|专业类别)\s*】|(?:专业要求|需求专业|所学专业|招聘专业)\s*[:：]?)\s*\n((?:[^\n]{2,160}\n?){1,6})/g;

const BLOCK_STOP_LINE_RE =
  /^\s*[*◆●•·-]?\s*【?\s*(?:招聘信息|职位描述|岗位职责|工作职责|工作内容|任职要求|任职资格|招聘条件|应聘条件|报名条件|基本条件|福利待遇|公司福利|薪酬福利|薪资待遇|薪资|投递方式|报名方式|应聘方式|联系方式|公司简介|单位简介|企业简介|关于我们|注意事项)/;

const RELATED_MAJOR_SUFFIX_RE =
  /([A-Za-z\u4e00-\u9fa5/／、，,\s&＆（）()与及和或]{2,100}?)(?:及相关专业|相关专业|类相关专业|等专业|类等专业|类专业|专业优先|专业毕业|专业应届|方向专业)(?!知识|技能|能力|水平|素养|术语|软件|工具|标准|法规|制度|培训|实务|人员|人士|人才|技术职务|资格|考试|认证|工作)/g;

const SAMPLE_POSITIONS_LINE_RE =
  /(?:^|\n)\s*(?:招聘岗位|需求岗位|热招岗位|招募岗位|校招岗位)\s*[:：]\s*([^\n。]{2,140})/g;

export const MAX_EXTRACTED_MAJORS = 20;

export function isUnlimitedMajorText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /^(?:专业不限|不限专业|不限所学专业|不限|无限制|无专业限制|所有专业|各专业均可)$/.test(trimmed) ||
    /专业不限|不限专业|不限所学专业|无专业限制/.test(trimmed);
}

function cleanCandidateMajorSegment(raw: string): string {
  let s = raw
    .replace(/（[^）]{24,}）|\([^)]{24,}\)/g, ' ')
    .replace(/^\s*(?:\(?[一二三四五六七八九十\d]+[、.．)）]\s*)+/, '')
    .replace(/^.*?(?:我们希望你来自|如果你是|主要面向|主要招收|招聘专业为|所学专业为|需求专业为|专业要求为|专业为|专业是|专业限)/, '')
    .replace(/^(?:全日制|统招|普通高校|国内外|境内外|应届|往届|202\d届|毕业生|研究生|博士|硕士|本科|大专|专科|学士|及以上|以上|学历|学位)+/g, '')
    .replace(/^(?:面向[^\s，,、]{0,12})?(?:招收|招聘|诚聘|欢迎|吸纳|面向|限|要求|具有|具备|主修|所学|以)/, '')
    .replace(/(?:等相关|及相关|类相关|相关|等专业|方向|背景|学历|毕业|应届毕业生|应届生|学生|优秀人士|人才|优先考虑|优先|为主|均可|皆可|等)+$/g, '')
    .replace(/(?:专业)$/g, '')
    .replace(/(?:等相关|及相关|类相关|相关|等)+$/g, '')
    .replace(/^[（()）【】[\]·•*◆●—:：\s-]+|[（()）【】[\]·•*◆●—:：\s-]+$/g, '')
    .replace(/^[与及和或]+/, '')
    .trim();

  if (s.includes('（') && !s.includes('）')) s = s.split('（')[0].trim();
  if (s.includes('(') && !s.includes(')')) s = s.split('(')[0].trim();
  return s;
}

export function isPlausibleMajorToken(token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed) return false;
  if (isUnlimitedMajorText(trimmed)) return true;

  const lower = trimmed.toLowerCase();
  if (/^(?:cpa|acca|cfa|frm|mpacc|maud|mba|mpa|mem|jm|llm|cs|se|ee|ic|ai|gis)$/i.test(trimmed)) {
    return true;
  }
  if (trimmed.length < 2 || trimmed.length > 22) return false;
  if (/^\d+$/.test(trimmed)) return false;
  if (KNOWN_ACADEMIC_MAJORS.has(lower)) return true;
  if (DISQUALIFYING_MAJOR_TOKEN_RE.test(trimmed)) return false;
  if (JOB_ROLE_NOT_MAJOR_SUFFIX_RE.test(trimmed)) return false;

  if (trimmed.endsWith('类') && trimmed.length >= 3) {
    const stem = trimmed.slice(0, -1);
    if (!GENERIC_CATEGORY_PREFIX_RE.test(stem) && ACADEMIC_DISCIPLINE_STEM_RE.test(stem)) {
      return true;
    }
  }
  return ACADEMIC_DISCIPLINE_STEM_RE.test(trimmed);
}

function collectValidMajorsFromChunk(chunk: string, out: Set<string>): void {
  const withoutLongParens = chunk.replace(/（[^）]{24,}）|\([^)]{24,}\)/g, ' ');
  const truncated = withoutLongParens.split(/[。！？!?]/)[0] || '';
  if (isUnlimitedMajorText(truncated)) {
    out.add(UNLIMITED_MAJOR_TOKEN);
  }
  // Keep "及" and "与" inside official MOE major names like "机械设计制造及其自动化" or "计算机科学与技术";
  // only strip trailing "及相关"/"等相关" via cleanCandidateMajorSegment.
  const normalizedSeparators = truncated.replace(/(?:及以上学历|及以上)/g, ' ');
  const parts = normalizedSeparators.split(/[\s,，、;/／；｜|或&＆:：（）()]+/);
  for (const rawPart of parts) {
    if (out.size >= MAX_EXTRACTED_MAJORS) break;
    if (/^(?:不限|无限制|专业不限|不限专业)$/.test(rawPart.trim())) {
      out.add(UNLIMITED_MAJOR_TOKEN);
      continue;
    }
    const cleaned = cleanCandidateMajorSegment(rawPart);
    if (!cleaned) continue;
    if (isPlausibleMajorToken(cleaned)) {
      out.add(cleaned);
    }
  }
}

/**
 * Strictly extracts explicit major requirements from plain-text recruitment announcements.
 * Never extracts ordinary duty/compliance nouns (e.g. "法律法规", "财务报销", "资产管理") outside major clauses.
 */
export function extractProseMajorsFromText(rawText: string): string[] {
  if (!rawText) return [];
  const text = rawText.slice(0, 12000);
  if (!text.includes('专业') && !text.includes('学历')) return [];

  const extracted = new Set<string>();

  if (UNLIMITED_INLINE_RE.test(text)) {
    extracted.add(UNLIMITED_MAJOR_TOKEN);
  }

  INLINE_MAJOR_LABEL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_MAJOR_LABEL_RE.exec(text)) !== null) {
    collectValidMajorsFromChunk(match[1], extracted);
    if (extracted.size >= MAX_EXTRACTED_MAJORS) break;
  }

  if (extracted.size < MAX_EXTRACTED_MAJORS) {
    MULTILINE_MAJOR_BLOCK_RE.lastIndex = 0;
    while ((match = MULTILINE_MAJOR_BLOCK_RE.exec(text)) !== null) {
      const lines = match[1].split('\n');
      for (const line of lines) {
        if (BLOCK_STOP_LINE_RE.test(line)) break;
        collectValidMajorsFromChunk(line, extracted);
        if (extracted.size >= MAX_EXTRACTED_MAJORS) break;
      }
      if (extracted.size >= MAX_EXTRACTED_MAJORS) break;
    }
  }

  if (extracted.size < MAX_EXTRACTED_MAJORS) {
    RELATED_MAJOR_SUFFIX_RE.lastIndex = 0;
    while ((match = RELATED_MAJOR_SUFFIX_RE.exec(text)) !== null) {
      const prefix = match[1];
      const tailClause = prefix.split(/[；;：:\n]/).at(-1) || prefix;
      const suffixWord = match[0].endsWith('类专业') ? `${tailClause}类` : tailClause;
      collectValidMajorsFromChunk(suffixWord, extracted);
      if (extracted.size >= MAX_EXTRACTED_MAJORS) break;
    }
  }

  return Array.from(extracted).slice(0, MAX_EXTRACTED_MAJORS);
}

const ROLE_TOKEN_SUFFIX_RE =
  /(?:岗|员|师|生|经理|主管|助理|顾问|代表|专家|总监|主任|方向|类|出纳|会计|法务|财务|审计|税务|编辑|记者|翻译|客服|柜员|策划|运营|人事|行政|采购)$/;

export function extractProseSamplePositions(rawText: string): string[] {
  if (!rawText || !rawText.includes('岗位')) return [];
  const text = rawText.slice(0, 6000);
  const found = new Set<string>();
  SAMPLE_POSITIONS_LINE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SAMPLE_POSITIONS_LINE_RE.exec(text)) !== null) {
    const tokens = match[1].split(/[\s,，、;/／；｜|]+/);
    for (const raw of tokens) {
      const cleaned = raw
        .replace(/^\(?[一二三四五六七八九十\d]+[、.．)）]/, '')
        .replace(/（[^）]*）|\([^)]*\)/g, '')
        .trim();
      if (
        cleaned.length >= 2 &&
        cleaned.length <= 18 &&
        !DISQUALIFYING_MAJOR_TOKEN_RE.test(cleaned) &&
        ROLE_TOKEN_SUFFIX_RE.test(cleaned)
      ) {
        found.add(cleaned);
        if (found.size >= 10) return Array.from(found);
      }
    }
  }
  return Array.from(found);
}

const profileCache = new Map<string, ResolvedJobMajorProfile>();

function buildSingleTermProfile(termLower: string): SingleTermMajorProfile {
  const matchedRules = MAJOR_FAMILY_RULES.filter((rule) =>
    rule.triggers.some((trigger) => trigger.toLowerCase() === termLower),
  );

  const effectiveRules =
    matchedRules.length > 0
      ? matchedRules
      : MAJOR_FAMILY_RULES.filter((rule) =>
          rule.triggers.some((t) => {
            const tl = t.toLowerCase();
            return tl.length >= 3 && termLower.length >= 3 && (termLower.includes(tl) || tl.includes(termLower));
          }),
        );

  const concreteSubstrings = new Set<string>([termLower]);
  const concreteExactTokens = new Set<string>();
  const umbrellaSubstrings = new Set<string>();
  const umbrellaExactTokens = new Set<string>();
  const broadUmbrellaSubstrings = new Set<string>();
  const broadUmbrellaExactTokens = new Set<string>();
  const roleKeywords = new Set<string>();
  const financeSectorRoleKeywords = new Set<string>();

  for (const alias of MAJOR_ALIASES[termLower] ?? []) {
    if (alias.length <= 2) concreteExactTokens.add(alias.toLowerCase());
    else concreteSubstrings.add(alias.toLowerCase());
  }

  if (effectiveRules.length > 0) {
    const offTrackRolePatterns: RegExp[] = [];
    for (const rule of effectiveRules) {
      for (const s of rule.concreteSubstrings) concreteSubstrings.add(s.toLowerCase());
      for (const s of rule.concreteExactTokens ?? []) concreteExactTokens.add(s.toLowerCase());
      for (const s of rule.umbrellaSubstrings) umbrellaSubstrings.add(s.toLowerCase());
      for (const s of rule.umbrellaExactTokens ?? []) umbrellaExactTokens.add(s.toLowerCase());
      for (const s of rule.broadUmbrellaSubstrings ?? []) broadUmbrellaSubstrings.add(s.toLowerCase());
      for (const s of rule.broadUmbrellaExactTokens ?? []) broadUmbrellaExactTokens.add(s.toLowerCase());
      for (const s of rule.roleKeywords) roleKeywords.add(s.toLowerCase());
      for (const s of rule.financeSectorRoleKeywords ?? []) financeSectorRoleKeywords.add(s.toLowerCase());
      if (rule.offTrackRolePattern) offTrackRolePatterns.push(rule.offTrackRolePattern);
    }
    return {
      summaryHint: effectiveRules[0].summaryHint,
      concreteSubstrings: Array.from(concreteSubstrings),
      concreteExactTokens: Array.from(concreteExactTokens),
      umbrellaSubstrings: Array.from(umbrellaSubstrings),
      umbrellaExactTokens: Array.from(umbrellaExactTokens),
      broadUmbrellaSubstrings: Array.from(broadUmbrellaSubstrings),
      broadUmbrellaExactTokens: Array.from(broadUmbrellaExactTokens),
      offTrackRolePatterns:
        offTrackRolePatterns.length === effectiveRules.length ? offTrackRolePatterns : [],
      roleKeywords: Array.from(roleKeywords),
      financeSectorRoleKeywords: Array.from(financeSectorRoleKeywords),
    };
  }

  const categories = resolveMajorCategories(undefined, [termLower]);
  for (const cat of categories) {
    umbrellaSubstrings.add(cat.toLowerCase());
    const stem = cat.replace(/类$/, '').toLowerCase();
    if (stem.length >= 3) umbrellaSubstrings.add(stem);
    if (cat !== '工商管理类' && cat !== '公共管理类') {
      for (const sibling of MAJOR_GROUPS[cat] ?? []) {
        const sibLower = sibling.toLowerCase();
        if (sibLower.length <= 2) concreteExactTokens.add(sibLower);
        else concreteSubstrings.add(sibLower);
      }
    }
  }
  if (termLower.length >= 2) {
    roleKeywords.add(termLower.replace(/学$/, ''));
  }

  const catLabel = categories.length > 0 ? ` · ${categories.join('/')}同大类专业` : '';
  return {
    summaryHint: `已关联可投范围：${termLower}${catLabel}及对口岗位`,
    concreteSubstrings: Array.from(concreteSubstrings),
    concreteExactTokens: Array.from(concreteExactTokens),
    umbrellaSubstrings: Array.from(umbrellaSubstrings),
    umbrellaExactTokens: Array.from(umbrellaExactTokens),
    broadUmbrellaSubstrings: [],
    broadUmbrellaExactTokens: [],
    offTrackRolePatterns: [],
    roleKeywords: Array.from(roleKeywords),
    financeSectorRoleKeywords: Array.from(financeSectorRoleKeywords),
  };
}

export function resolveJobMajorProfile(rawQuery: string): ResolvedJobMajorProfile {
  const normalized = (rawQuery || '').trim().toLowerCase();
  if (!normalized || normalized === '全部') {
    return {
      active: false,
      summaryHint: '',
      concreteSubstrings: [],
      concreteExactTokens: [],
      umbrellaSubstrings: [],
      umbrellaExactTokens: [],
      broadUmbrellaSubstrings: [],
      broadUmbrellaExactTokens: [],
      roleKeywords: [],
      financeSectorRoleKeywords: [],
      subProfiles: [],
    };
  }

  const cached = profileCache.get(normalized);
  if (cached) return cached;

  const queryTerms = normalized.split(/[\s,，、;/／]+/).filter(Boolean);
  const subProfiles = queryTerms.map(buildSingleTermProfile);

  const merged: ResolvedJobMajorProfile = {
    active: true,
    summaryHint:
      subProfiles.length === 1
        ? subProfiles[0].summaryHint
        : `已组合 ${queryTerms.join(' + ')} 的相关专业、上位大类及对口岗位`,
    concreteSubstrings: [...new Set(subProfiles.flatMap((p) => p.concreteSubstrings))],
    concreteExactTokens: [...new Set(subProfiles.flatMap((p) => p.concreteExactTokens))],
    umbrellaSubstrings: [...new Set(subProfiles.flatMap((p) => p.umbrellaSubstrings))],
    umbrellaExactTokens: [...new Set(subProfiles.flatMap((p) => p.umbrellaExactTokens))],
    broadUmbrellaSubstrings: [...new Set(subProfiles.flatMap((p) => p.broadUmbrellaSubstrings))],
    broadUmbrellaExactTokens: [...new Set(subProfiles.flatMap((p) => p.broadUmbrellaExactTokens))],
    roleKeywords: [...new Set(subProfiles.flatMap((p) => p.roleKeywords))],
    financeSectorRoleKeywords: [...new Set(subProfiles.flatMap((p) => p.financeSectorRoleKeywords))],
    subProfiles,
  };

  if (profileCache.size > 200) profileCache.clear();
  profileCache.set(normalized, merged);
  return merged;
}

function majorListMatchesDirect(explicitMajors: readonly string[], sub: SingleTermMajorProfile): boolean {
  const joinedLower = explicitMajors.join(' 、 ').toLowerCase();
  for (const s of sub.concreteSubstrings) {
    if (s && joinedLower.includes(s)) return true;
  }
  for (const s of sub.umbrellaSubstrings) {
    if (s && joinedLower.includes(s)) return true;
  }
  if (sub.concreteExactTokens.length > 0 || sub.umbrellaExactTokens.length > 0) {
    const tokens = tokenizeMajorClauses(joinedLower);
    for (const exact of sub.concreteExactTokens) {
      if (tokens.has(exact) || tokens.has(`${exact}类`) || tokens.has(`${exact}学`)) return true;
    }
    for (const exact of sub.umbrellaExactTokens) {
      if (tokens.has(exact) || tokens.has(`${exact}类`) || tokens.has(`${exact}学`)) return true;
    }
  }
  return false;
}

function majorListMatchesBroadUmbrella(explicitMajors: readonly string[], sub: SingleTermMajorProfile): boolean {
  if (sub.broadUmbrellaSubstrings.length === 0 && sub.broadUmbrellaExactTokens.length === 0) return false;
  const joinedLower = explicitMajors.join(' 、 ').toLowerCase();
  for (const s of sub.broadUmbrellaSubstrings) {
    if (s && joinedLower.includes(s)) return true;
  }
  if (sub.broadUmbrellaExactTokens.length > 0) {
    const tokens = tokenizeMajorClauses(joinedLower);
    for (const exact of sub.broadUmbrellaExactTokens) {
      if (tokens.has(exact) || tokens.has(`${exact}类`) || tokens.has(`${exact}学`)) return true;
    }
  }
  return false;
}

function isOffTrackSingleRole(roleCheckText: string, sub: SingleTermMajorProfile): boolean {
  if (!roleCheckText || sub.offTrackRolePatterns.length === 0) return false;
  const lower = roleCheckText.toLowerCase();
  return sub.offTrackRolePatterns.every((re) => re.test(lower));
}

function containsKeywordWithAsciiBoundary(haystackLower: string, keyword: string): boolean {
  if (!keyword) return false;
  if (/^[a-z0-9.+#]+$/i.test(keyword)) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(haystackLower);
  }
  return haystackLower.includes(keyword);
}

const PURE_ANNOUNCEMENT_SUFFIX_RE =
  /^[-—·:：\s]*(?:202\d\s*[年届]?)?\s*(?:春季|秋季|春招|秋招|暑期|寒假|校园|社会|公开|专项|正式|补录|社招|校招)*\s*(?:招聘简章|招聘公告|招聘启事|招聘信息|校园招聘|社会招聘|公开招聘|人才引进公告|人才招聘|招募令|招聘)\s*$/;

const TRAILING_ATS_JOB_CODE_RE = /(?:\s*[（([][A-Za-z]{1,5}[-_]?\d{3,10}[)）\]])+\s*$/;

const LEADING_EMPLOYER_PREFIX_RE =
  /^[^\s·—-]{2,26}(?:股份有限公司|有限责任公司|有限公司|集团有限公司|集团|研究院|研究所|开发局|就业局|银行|分行|支行|财险|产险|寿险|人寿)(?:[-—·]?[^\s·—-]{0,12}(?:分行|支行|分公司|子公司|支公司|事业部))?/;

const LEADING_ORG_UNIT_PREFIX_RE =
  /^(?:[^-—·/\s]{1,20}(?:分公司|子公司|支公司|分行|支行|事业部|营销中心|研发中心|技术中心|共享中心|运营中心|服务中心|管理中心|制造中心|供应链中心|财经中心|交付中心|品牌中心|总部|中国区|华北区|华东区|华南区|华中区|西南区|西北区|东北区|大区|片区|省区)\s*[-—·]+\s*)+/;

/**
 * Strips the employer/organization/department prefix from `job.title` so words inside the company
 * or center name (e.g. "青岛数能电气工程有限公司招聘", "海南省人力资源开发局招聘", "全国营销中心-财务管理")
 * never falsely trigger or block role-title matching.
 */
export function extractRolePortionFromJobTitle(job: Pick<Job, 'title' | 'company'>): string {
  let title = (job.title || '').trim();
  if (!title) return '';

  title = title.replace(TRAILING_ATS_JOB_CODE_RE, '').trim();

  if (title.includes('·')) {
    const parts = title.split('·').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      title = parts.slice(1).join(' · ');
    }
  } else {
    const company = (job.company || '').trim();
    if (company && company !== '招聘单位见原页面' && title.startsWith(company)) {
      title = title.slice(company.length).trim();
    } else if (LEADING_EMPLOYER_PREFIX_RE.test(title)) {
      title = title.replace(LEADING_EMPLOYER_PREFIX_RE, '').trim();
    }
  }

  title = title.replace(/^[-—·:：\s]+/, '').trim();
  const withoutOrgUnit = title.replace(LEADING_ORG_UNIT_PREFIX_RE, '').trim();
  if (withoutOrgUnit) {
    title = withoutOrgUnit;
  }

  if (PURE_ANNOUNCEMENT_SUFFIX_RE.test(title)) return '';
  return title;
}

function roleTitleMatchesSubProfile(
  roleTexts: readonly (string | undefined)[],
  sub: SingleTermMajorProfile,
  isBankBrokerageSector = false,
): boolean {
  const combined = roleTexts.filter(Boolean).join(' · ').toLowerCase();
  if (!combined) return false;

  for (const kw of sub.roleKeywords) {
    if (containsKeywordWithAsciiBoundary(combined, kw)) return true;
  }
  if (isBankBrokerageSector) {
    for (const kw of sub.financeSectorRoleKeywords) {
      if (containsKeywordWithAsciiBoundary(combined, kw)) return true;
    }
  }
  return false;
}

function singleProfileMatchesPosition(
  explicitMajors: readonly string[],
  unlimitedItems: readonly string[],
  roleTexts: readonly (string | undefined)[],
  roleCheckText: string,
  sub: SingleTermMajorProfile,
  options?: MajorMatchOptions,
): boolean {
  if (explicitMajors.length > 0) {
    if (majorListMatchesDirect(explicitMajors, sub)) return true;
    if (majorListMatchesBroadUmbrella(explicitMajors, sub)) {
      if (roleTitleMatchesSubProfile(roleTexts, sub) || !isOffTrackSingleRole(roleCheckText, sub)) {
        return true;
      }
    }
    if (
      unlimitedItems.length > 0 &&
      (Boolean(options?.includeUnlimited) || roleTitleMatchesSubProfile(roleTexts, sub))
    ) {
      return true;
    }
    return false;
  }

  if (unlimitedItems.length > 0) {
    return Boolean(options?.includeUnlimited) || roleTitleMatchesSubProfile(roleTexts, sub);
  }

  return roleTitleMatchesSubProfile(roleTexts, sub);
}

/**
 * Evaluates whether a single structured position row matches the user's major filter.
 * Respects same-position alignment: explicit non-matching majors on this row block role-title fallback.
 */
export function positionMatchesMajor(
  position: PositionRequirement,
  rawQuery: string,
  options?: MajorMatchOptions,
): boolean {
  const profile = resolveJobMajorProfile(rawQuery);
  if (!profile.active) return true;

  const rawMajors = (position.majors ?? []).map((m) => m.trim()).filter(Boolean);
  const unlimitedItems = rawMajors.filter(isUnlimitedMajorText);
  const explicitMajors = rawMajors.filter((m) => !isUnlimitedMajorText(m));
  const roleTexts = [position.name, position.category];
  const roleCheckText = [position.name, position.category].filter(Boolean).join(' · ');

  return profile.subProfiles.some((sub) =>
    singleProfileMatchesPosition(explicitMajors, unlimitedItems, roleTexts, roleCheckText, sub, options),
  );
}

const jobDerivedFactsCache = new WeakMap<
  Job,
  {
    majorsRef: string[] | undefined;
    bodyRef: string | undefined;
    excerptRef: string;
    majors: string[];
    samplePositions: string[];
  }
>();

function getEffectiveJobMajorFacts(job: Job): { majors: string[]; samplePositions: string[] } {
  const cached = jobDerivedFactsCache.get(job);
  if (
    cached &&
    cached.majorsRef === job.majors &&
    cached.bodyRef === job.body &&
    cached.excerptRef === job.excerpt
  ) {
    return cached;
  }

  const proseSource = `${job.body || ''}\n${job.card_summary ? '' : job.excerpt || ''}`;
  const majors = job.majors?.length ? job.majors : extractProseMajorsFromText(proseSource);
  const samplePositions = job.sample_positions?.length
    ? job.sample_positions
    : extractProseSamplePositions(proseSource);

  const entry = {
    majorsRef: job.majors,
    bodyRef: job.body,
    excerptRef: job.excerpt,
    majors,
    samplePositions,
  };
  jobDerivedFactsCache.set(job, entry);
  return entry;
}

const BANK_BROKERAGE_CONTEXT_RE = /银行|证券|基金|期货|信托|投行|农信|信用社|理财子公司/;

function singleProfileMatchesJob(
  job: Job,
  explicitMajors: readonly string[],
  unlimitedItems: readonly string[],
  samplePositionsCount: number,
  roleTexts: readonly (string | undefined)[],
  singleRoleCheckText: string,
  isBankBrokerageSector: boolean,
  sub: SingleTermMajorProfile,
  options?: MajorMatchOptions,
): boolean {
  if (explicitMajors.length > 0) {
    if (majorListMatchesDirect(explicitMajors, sub)) return true;
    if (majorListMatchesBroadUmbrella(explicitMajors, sub)) {
      if (
        job.kind === '招聘公告' ||
        roleTitleMatchesSubProfile(roleTexts, sub, isBankBrokerageSector) ||
        !isOffTrackSingleRole(singleRoleCheckText, sub)
      ) {
        return true;
      }
    }
    if (
      job.kind === '招聘公告' &&
      samplePositionsCount >= 2 &&
      roleTitleMatchesSubProfile(roleTexts, sub, isBankBrokerageSector)
    ) {
      return true;
    }
    if (
      unlimitedItems.length > 0 &&
      (Boolean(options?.includeUnlimited) || roleTitleMatchesSubProfile(roleTexts, sub, isBankBrokerageSector))
    ) {
      return true;
    }
    return false;
  }

  if (unlimitedItems.length > 0) {
    return (
      Boolean(options?.includeUnlimited) ||
      roleTitleMatchesSubProfile(roleTexts, sub, isBankBrokerageSector)
    );
  }

  return roleTitleMatchesSubProfile(roleTexts, sub, isBankBrokerageSector);
}

/**
 * Evaluates whether a job announcement (without row-level `positions`) matches the user's major filter.
 */
export function jobMatchesMajor(job: Job, rawQuery: string, options?: MajorMatchOptions): boolean {
  const profile = resolveJobMajorProfile(rawQuery);
  if (!profile.active) return true;

  const { majors: rawMajors, samplePositions } = getEffectiveJobMajorFacts(job);
  const unlimitedItems = rawMajors.filter(isUnlimitedMajorText);
  const explicitMajors = rawMajors.filter((m) => !isUnlimitedMajorText(m));

  const isBankBrokerageSector =
    job.sectors.includes('银行') ||
    BANK_BROKERAGE_CONTEXT_RE.test(`${job.company || ''} ${job.title || ''}`);
  const roleTitle = extractRolePortionFromJobTitle(job);
  const roleTexts = [roleTitle, ...samplePositions];
  const singleRoleCheckText = roleTitle || samplePositions.join(' · ');

  return profile.subProfiles.some((sub) =>
    singleProfileMatchesJob(
      job,
      explicitMajors,
      unlimitedItems,
      samplePositions.length,
      roleTexts,
      singleRoleCheckText,
      isBankBrokerageSector,
      sub,
      options,
    ),
  );
}
