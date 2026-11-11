import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocationPresentation,
  formatDetailTitle,
  parseStructuredJobBody,
} from '../lib/job-detail-format.ts';

void test('formatDetailTitle extracts trailing ATS code without touching graduation years', () => {
  const hisense = formatDetailTitle({
    title: '销售经理（全国）(J45816)',
    company: '全球营销中心-中国区',
    source_id: 'hisense-campus',
    excerpt: '',
  });
  assert.equal(hisense.title, '销售经理（全国）');
  assert.equal(hisense.atsCode, 'J45816');

  const cohortJob = formatDetailTitle({
    title: '中国银行山东省分行校园招聘 (2027)',
    company: '中国银行山东省分行',
    source_id: 'sdu',
    excerpt: '',
  });
  assert.equal(cohortJob.atsCode, null);
  assert.ok(cohortJob.title.includes('2027'));
});

void test('buildLocationPresentation prioritizes Shandong/filter cities and strips redundant or contaminated evidence', () => {
  const hisenseLoc = buildLocationPresentation(
    {
      cities: ['北京', '天津', '济南', '青岛', '福州', '广州', '深圳'],
      location_evidence: [
        '工作地点：福建省·福州市、广东省·广州市/深圳市、北京市、天津市、山东省·青岛市/济南市；工作地点: 1. 承接公司销售目标，制定区域 / 客户 / 渠道销售计划并落地，完成业绩指标。',
      ],
    },
    ['青岛'],
  );
  assert.deepEqual(hisenseLoc.chips.slice(0, 3), ['青岛', '济南', '北京']);
  assert.equal(hisenseLoc.prioritizedCount, 2);
  assert.equal(hisenseLoc.supplement, null);

  const districtLoc = buildLocationPresentation({
    cities: ['青岛'],
    location_evidence: ['工作地点：山东省青岛市崂山区'],
  });
  assert.equal(districtLoc.supplement, '山东省青岛市崂山区');

  const unlistedCity = buildLocationPresentation({
    cities: [],
    location_evidence: ['工作地点：均在江苏常州。'],
  });
  assert.equal(unlistedCity.supplement, '均在江苏常州');
  assert.equal(unlistedCity.fallbackText, '均在江苏常州');
});

void test('parseStructuredJobBody strips duplicate headers, rescues missing education/deadline, and structures sections', () => {
  const portalJob = parseStructuredJobBody({
    title: '产品定价专员(J45816)',
    company: '全球营销中心-中国区',
    cities: ['济南'],
    education: '未明确 / 见原公告',
    deadline: null,
    types: ['校招'],
    graduation_years: ['2027'],
    body: [
      '招聘单位：全球营销中心-中国区',
      '岗位名称：产品定价专员(J45816)',
      '工作地点：山东省济南市',
      '学历要求：本科生毕业',
      '专业要求：财政学类',
      '招聘人数：2',
      '报名截止：2026-11-30',
      '岗位职责：岗位职责',
      '1.协助团队开展产品定价相关工作；',
      '2.学习并运用定价模型，撰写分析报告。',
      '任职要求',
      '1.工商管理、市场营销、财会类等相关专业。',
      '2.熟悉基础定价模型，擅长Excel数据分析。',
    ].join('\n'),
  });

  assert.equal(portalJob.extractedEducation, '本科生毕业');
  assert.equal(portalJob.extractedDeadline, '2026-11-30');
  assert.deepEqual(portalJob.extraMeta, [
    { label: '专业要求', value: '财政学类' },
    { label: '招聘人数', value: '2人' },
  ]);
  assert.equal(portalJob.sections.length, 2);
  assert.equal(portalJob.sections[0].heading, '岗位职责');
  assert.deepEqual(portalJob.sections[0].blocks, [
    {
      type: 'list',
      ordered: true,
      items: ['协助团队开展产品定价相关工作；', '学习并运用定价模型，撰写分析报告。'],
    },
  ]);
  assert.equal(portalJob.sections[1].heading, '任职要求');
});

void test('parseStructuredJobBody strips SDU boilerplate, splits inline numbered items, and groups consecutive role lines', () => {
  const sduParsed = parseStructuredJobBody({
    title: '常州市晋陵投资集团有限公司招聘',
    company: '常州市晋陵投资集团有限公司',
    cities: [],
    education: '未明确 / 见原公告',
    deadline: null,
    types: ['校招'],
    graduation_years: ['2027'],
    body: [
      '招聘信息',
      '标题',
      '常州市晋陵投资集团有限公司招聘',
      '招聘截止日期',
      '2026-10-20',
      '应聘网址',
      '简历投递邮箱',
      'jljituanhr@czjlgroup.com',
      '单位介绍：',
      '常州市晋陵投资集团有限公司是常州市直属国有平台公司。',
      '岗位职责：1. 承接公司销售目标，完成业绩指标。 2. 开拓新客户，维护区域渠道。',
      '招聘岗位',
      '岗位：有机合成类（小分子/多肽）',
      '岗位：药物分析类（小分子/酶）',
      '此条为第三方公开招聘线索，工作地和资格尚未通过企业原公告交叉核验。请打开来源核对投递方式。',
    ].join('\n'),
  });

  assert.equal(sduParsed.extractedDeadline, '2026-10-20');
  assert.ok(sduParsed.sourceDisclaimer?.includes('第三方公开招聘线索'));
  assert.equal(sduParsed.sections.length, 3);
  assert.equal(sduParsed.sections[0].heading, '单位介绍');
  assert.equal(sduParsed.sections[1].heading, '岗位职责');
  assert.deepEqual(sduParsed.sections[1].blocks, [
    {
      type: 'list',
      ordered: true,
      items: ['承接公司销售目标，完成业绩指标。', '开拓新客户，维护区域渠道。'],
    },
  ]);
  assert.deepEqual(sduParsed.sections[2].blocks, [
    {
      type: 'roles',
      items: ['有机合成类（小分子/多肽）', '药物分析类（小分子/酶）'],
    },
  ]);

  const plainShort = parseStructuredJobBody({
    title: '核验岗位7',
    company: '核验单位7',
    cities: ['北京'],
    education: '本科',
    deadline: null,
    types: ['校招'],
    graduation_years: ['2027'],
    body: '核验岗位7 公告正文',
  });
  assert.equal(plainShort.sections.length, 1);
  assert.deepEqual(plainShort.sections[0].blocks, [
    { type: 'paragraph', text: '核验岗位7 公告正文' },
  ]);

  // Real-world Hisense header: 岗位类别 + >160-char 30-city wall + 薪资：面议 + numbered 学历：本科及以上学历；
  const longCityWall =
    '福建省·福州市、广东省·广州市/深圳市、江西省·南昌市、江苏省·南京市/无锡市、上海市、浙江省·宁波市/杭州市、北京市、天津市、山西省·太原市、河北省·石家庄市、山东省·青岛市/临沂市/济南市、陕西省·西安市、河南省·漯河市/郑州市、甘肃省·兰州市、辽宁省·沈阳市、吉林省·长春市、重庆市、贵州省·贵阳市、四川省·成都市、云南省·昆明市、安徽省·合肥市、湖南省·长沙市、湖北省·武汉市、广西壮族自治区·南宁市';
  const hisenseReal = parseStructuredJobBody({
    title: '销售经理（全国）(J45816)',
    company: '海信集团',
    cities: [
      '福州', '广州', '深圳', '南昌', '南京', '无锡', '上海', '宁波', '杭州', '北京',
      '天津', '太原', '石家庄', '青岛', '临沂', '济南', '西安', '漯河', '郑州', '兰州',
      '沈阳', '长春', '重庆', '贵阳', '成都', '昆明', '合肥', '长沙', '武汉', '南宁',
    ],
    education: '未明确',
    deadline: null,
    types: ['校招'],
    graduation_years: ['2027'],
    body: [
      '岗位类别：营销类',
      `工作地点：${longCityWall}`,
      '薪资：面议',
      '岗位职责：',
      '1. 承接公司销售目标，完成业绩指标。',
      '任职要求：',
      '1. 院校：国内普通高等院校（2027年毕业）；',
      '2. 学历：本科及以上学历；',
    ].join('\n'),
  });
  assert.equal(hisenseReal.extractedEducation, '本科及以上');
  assert.deepEqual(hisenseReal.extraMeta, [{ label: '岗位类别', value: '营销类' }]);
  assert.equal(hisenseReal.sections.length, 2);
  assert.equal(hisenseReal.sections[0].heading, '岗位职责');
});
