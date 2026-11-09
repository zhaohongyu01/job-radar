/**
 * 参照教育部《普通高等学校本科专业目录》整理的常见考公考编专业大类映射表。
 * 用于考编画像“专业大类 + 具体专业”两步资格判定。
 */
export const MAJOR_GROUPS: Record<string, readonly string[]> = {
  计算机类: [
    '计算机科学与技术',
    '软件工程',
    '网络工程',
    '信息安全',
    '物联网工程',
    '数字媒体技术',
    '智能科学与技术',
    '空间信息与数字技术',
    '数据科学与大数据技术',
    '网络空间安全',
    '电子与计算机工程',
    '人工智能',
  ],
  电子信息类: [
    '电子信息工程',
    '电子科学与技术',
    '通信工程',
    '微电子科学与工程',
    '光电信息科学与工程',
    '信息工程',
    '电子信息科学与技术',
    '集成电路设计与集成系统',
    '电信工程及管理',
  ],
  自动化类: [
    '自动化',
    '轨道交通信号与控制',
    '机器人工程',
    '智能装备与系统',
  ],
  电气类: [
    '电气工程及其自动化',
    '智能电网信息工程',
    '光源与照明',
    '电气工程与智能控制',
  ],
  机械类: [
    '机械工程',
    '机械设计制造及其自动化',
    '材料成型及控制工程',
    '机械电子工程',
    '工业设计',
    '过程装备与控制工程',
    '车辆工程',
    '智能制造工程',
  ],
  土木类: [
    '土木工程',
    '建筑环境与能源应用工程',
    '给排水科学与工程',
    '建筑电气与智能化',
    '城市地下空间工程',
    '道路桥梁与渡河工程',
    '智能建造',
  ],
  材料类: [
    '材料科学与工程',
    '材料物理',
    '材料化学',
    '冶金工程',
    '金属材料工程',
    '无机非金属材料工程',
    '高分子材料与工程',
    '复合材料与工程',
    '新能源材料与器件',
  ],
  化学类: [
    '化学',
    '应用化学',
    '化学生物学',
    '分子科学与工程',
    '能源化学',
  ],
  环境科学与工程类: [
    '环境科学与工程',
    '环境工程',
    '环境科学',
    '环境生态工程',
    '环保设备工程',
    '资源环境科学',
  ],
  数学类: [
    '数学与应用数学',
    '信息与计算科学',
    '数理基础科学',
    '数据计算及应用',
  ],
  统计学类: [
    '统计学',
    '应用统计学',
    '经济统计学',
  ],
  心理学类: [
    '心理学',
    '应用心理学',
  ],
  经济学类: [
    '经济学',
    '国民经济管理',
    '资源与环境经济学',
    '商务经济学',
    '能源经济',
    '数字经济',
  ],
  财政学类: [
    '财政学',
    '税收学',
  ],
  金融学类: [
    '金融学',
    '金融工程',
    '保险学',
    '投资学',
    '金融数学',
    '信用管理',
    '经济与金融',
    '互联网金融',
    '金融科技',
  ],
  工商管理类: [
    '工商管理',
    '市场营销',
    '会计学',
    '会计',
    '财务管理',
    '国际商务',
    '人力资源管理',
    '审计学',
    '审计',
    '资产评估',
    '物业管理',
    '文化产业管理',
    '财务会计教育',
  ],
  公共管理类: [
    '公共事业管理',
    '行政管理',
    '劳动与社会保障',
    '土地资源管理',
    '城市管理',
    '海关管理',
    '交通管理',
    '海事管理',
    '公共关系学',
    '健康服务与管理',
    '应急管理',
  ],
  法学类: [
    '法学',
    '知识产权',
    '监狱学',
    '信用风险管理与法律防控',
    '国际经贸规则',
    '司法警察学',
    '社区矫正',
    '纪检监察',
  ],
  中国语言文学类: [
    '汉语言文学',
    '汉语言',
    '汉语国际教育',
    '中国少数民族语言文学',
    '古典文献学',
    '应用语言学',
    '秘书学',
  ],
  外国语言文学类: [
    '英语',
    '俄语',
    '德语',
    '法语',
    '西班牙语',
    '阿拉伯语',
    '日语',
    '朝鲜语',
    '翻译',
    '商务英语',
  ],
  新闻传播学类: [
    '新闻学',
    '广播电视学',
    '广告学',
    '传播学',
    '编辑出版学',
    '网络与新媒体',
    '数字出版',
    '时尚传播',
  ],
  教育学类: [
    '教育学',
    '科学教育',
    '人文教育',
    '教育技术学',
    '艺术教育',
    '学前教育',
    '小学教育',
    '特殊教育',
    '华文教育',
  ],
  体育学类: [
    '体育教育',
    '运动训练',
    '社会体育指导与管理',
    '武术与民族传统体育',
    '运动人体科学',
    '运动康复',
    '休闲体育',
  ],
  临床医学类: [
    '临床医学',
    '麻醉学',
    '医学影像学',
    '眼视光医学',
    '精神医学',
    '放射医学',
    '儿科学',
  ],
  护理学类: [
    '护理学',
    '助产学',
  ],
  药学类: [
    '药学',
    '药物制剂',
    '临床药学',
    '药事管理',
    '药物分析',
    '药物化学',
    '海洋药学',
  ],
  农学类: [
    '农学',
    '园艺',
    '植物保护',
    '植物科学与技术',
    '种子科学与工程',
    '设施农业科学与工程',
    '茶学',
    '烟草',
    '应用生物科学',
  ],
};

export const MAJOR_CATEGORY_NAMES: readonly string[] = Object.keys(MAJOR_GROUPS);

/**
 * 岗位表中常见的“同一专业简称/学字省略”等价映射。
 * 仅在分词后的独立专业词项上做等价命中，避免短词误伤其他复合专业名。
 */
export const MAJOR_ALIASES: Record<string, readonly string[]> = {
  会计学: ['会计'],
  会计: ['会计学'],
  审计学: ['审计'],
  审计: ['审计学'],
  金融学: ['金融'],
  金融: ['金融学'],
  经济学: ['经济'],
  经济: ['经济学'],
  财政学: ['财政'],
  财政: ['财政学'],
  统计学: ['统计'],
  统计: ['统计学'],
  新闻学: ['新闻'],
  新闻: ['新闻学'],
  护理学: ['护理'],
  护理: ['护理学'],
  法学: ['法律'],
  法律: ['法学'],
  汉语言文学: ['中文'],
  中文: ['汉语言文学'],
};

export function tokenizeMajorClauses(rawText: string): Set<string> {
  const tokens = new Set<string>();
  const parts = rawText
    .toLowerCase()
    .split(/[\s,，、;/；:：。()（）【】[\]“”"'或]+/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    tokens.add(trimmed);
    if (trimmed.length > 2 && trimmed.endsWith('专业')) {
      tokens.add(trimmed.slice(0, -2));
    }
  }
  return tokens;
}

export function findConcreteMajorMatch(
  queryTerms: string[],
  rawMajorLower: string,
  positionNameLower: string,
): string | null {
  for (const term of queryTerms) {
    if (rawMajorLower.includes(term) || positionNameLower.includes(term)) {
      return term;
    }
  }
  const clauseTokens = tokenizeMajorClauses(rawMajorLower);
  for (const term of queryTerms) {
    const aliases = MAJOR_ALIASES[term];
    if (!aliases) continue;
    for (const alias of aliases) {
      if (clauseTokens.has(alias.toLowerCase())) {
        return alias;
      }
    }
  }
  return null;
}

export function resolveMajorCategories(
  majorCategory: string | undefined,
  queryTerms: string[],
): string[] {
  const categories = new Set<string>();
  const explicitCat = majorCategory?.trim() || '';
  if (explicitCat && Object.hasOwn(MAJOR_GROUPS, explicitCat)) {
    categories.add(explicitCat);
  }

  for (const term of queryTerms) {
    const candidateTerms = [term, ...(MAJOR_ALIASES[term] ?? []).map((a) => a.toLowerCase())];
    if (
      explicitCat &&
      categories.has(explicitCat) &&
      MAJOR_GROUPS[explicitCat].some((m) => candidateTerms.includes(m.toLowerCase()))
    ) {
      continue;
    }
    for (const [cat, majors] of Object.entries(MAJOR_GROUPS)) {
      if (majors.some((m) => candidateTerms.includes(m.toLowerCase()))) {
        categories.add(cat);
      }
    }
  }

  return Array.from(categories);
}

export function hasSiblingMajorInCategories(
  categories: string[],
  rawMajorLower: string,
): boolean {
  if (categories.length === 0) return false;
  const clauseTokens = tokenizeMajorClauses(rawMajorLower);
  for (const cat of categories) {
    const majors = MAJOR_GROUPS[cat];
    if (!majors) continue;
    for (const major of majors) {
      const mLower = major.toLowerCase();
      if (mLower.length <= 3 ? clauseTokens.has(mLower) : rawMajorLower.includes(mLower)) {
        return true;
      }
    }
  }
  return false;
}
