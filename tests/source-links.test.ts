import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayJobTitle, sdeiPositionListUrl } from '../lib/jobs.ts';

void test('SDEI broken detail has a separate public list fallback without rewriting identity', () => {
  const url = 'https://school.gxjy.sdei.edu.cn/lcu/school/companyissueinfo/edit1/21395';
  assert.equal(sdeiPositionListUrl(url), 'https://school.gxjy.sdei.edu.cn/lcu/front/JiuYeInfo?type=zwxx');
  for (const invalid of [url.replace('sdei.edu.cn', 'sdei.edu.cn.evil.test'), 'javascript:alert(1)', url.replace('/edit1/21395', '/list1'), url.replace('https://', 'https://user:password@')]) {
    assert.equal(sdeiPositionListUrl(invalid), null);
  }
});

void test('missing employer title does not promise a working original page or invent a company', () => {
  assert.equal(displayJobTitle({title: '招聘单位见原页面 · 销售代表', company: ''}), '单位名称待核实 · 销售代表');
  assert.equal(displayJobTitle({title: '招聘单位见原页面 · 销售代表', company: '测试公司'}), '测试公司 · 销售代表');
  assert.equal(displayJobTitle({title: '已有公司 · 销售代表', company: ''}), '已有公司 · 销售代表');
});
