"""Keep official employer brand and department separate from retained company facts."""
import json
from pathlib import Path
import re

CONFIG = json.loads((Path(__file__).resolve().parents[1] / 'config/employer-brands.json').read_text(encoding='utf-8'))
DEPARTMENT = re.compile(CONFIG['department_pattern'])

AGENCY_COMPANY_PAT = re.compile(r'网聘|高层次人才网|千才汇|高博中进|月生信息|南方国际人力资源|前程无忧|智联招聘|猎聘|考仕网|高校人才网|神州硕博|高才信息|海天创高')
TITLE_EMPLOYER_PAT = re.compile(
    r'^(?:[？?]|【[^】]{1,15}】|招聘\s*[|｜:：]\s*|(?:20\d{2}\s*年(?:度)?(?:上半年|下半年)?\s*)|(?:[^—\-｜|：:“”]{2,16}(?:[—\-]{2,}|[|｜]|”)\s*))*'
    r'([\u4e00-\u9fffA-Za-z0-9\uff21-\uff3a\uff41-\uff5a\uff10-\uff19（）()·—\-]{2,60}?'
    r'(?:'
    r'(?:有限责任公司|股份有限公司|有限公司)(?:[\u4e00-\u9fff0-9（）()]{2,24}?(?:分公司|支公司|分行|支行|中心|总厂|厂|研究所|研究院|设计院|分院|医院|学校|经营部|事业部|分所|实验室|局|处|站|部))?'
    r'|(?:集团|总)公司(?:[\u4e00-\u9fff0-9（）()]{2,20}?(?:研究所|研究院|设计院|分公司|医院|中心|厂|院|所))?'
    r'|(?:会计师|律师|税务师)事务所(?:[（(][\u4e00-\u9fff]{2,15}[）)])?(?:[\u4e00-\u9fff]{2,12}分所)?'
    r'|[\u4e00-\u9fff]{2,24}(?:银行(?:股份有限公司)?(?:[\u4e00-\u9fff]{0,15}(?:分行|支行|总行|中心|信用卡中心|软件中心))?|大学|学院|党校|中学|附属中学分校|学校|医院|研究院|研究所|设计院|设计研究院|科学研究院|科学院|实验室|开发局|就业局|气象局|地震局|水文局|航道局|海事局|管理局|广播电视台|报社|出版社)(?:[（(][\u4e00-\u9fff0-9]{2,20}[）)])?'
    r'))(?=\s|招聘|20\d{2}|校园|社会|春季|秋季|寒假|暑假|高层次|公开|诚聘|选聘|引进|常年|教师|博士|硕士|简章|公告|启事|专场|实习|特别研究助理|[—\-｜|：:]|$)'
)


def employer_identity(job):
    brand = CONFIG['sources'].get(job.get('source_id'))
    if not brand:
        return {}
    result = {'employer_brand': brand}
    company = (job.get('company') or '').strip()
    if company and DEPARTMENT.search(company):
        result['company_department'] = company
    return result


def company_matches_announcement(company, title, text):
    compact = lambda value: re.sub(r'\s+', '', value or '').translate(str.maketrans('（）', '()'))
    c = compact(company)
    if not c:
        return False
    t_comp = compact(title)
    if c in t_comp or t_comp.startswith(re.sub(r'(?:股份)?(?:有限责任公司|有限公司)$', '', c)):
        return True
    if AGENCY_COMPANY_PAT.search(c):
        return False
    haystack = compact(text + '\n' + title)
    if c in haystack:
        return True
    c_no_paren = re.sub(r'\([^)]*\)', '', c)
    stems = set()
    for base in (c, c_no_paren):
        s0 = re.sub(r'(?:股份)?(?:有限责任公司|有限公司)', '', base)
        s1 = re.sub(r'(?:股份)?(?:有限责任公司|有限公司)(?:[\u4e00-\u9fff]{2,15}(?:分公司|支公司))?$', '', base)
        s2 = re.sub(r'(?:集团)?(?:控股|数字技术|光电技术|在线网络技术|互动网络技术|网络技术|信息技术|网络科技|教育科技|科技|信息|网络|软件|电子|实业|发展|投资|管理|物业管理|资产管理|商业管理|商贸|贸易|国际贸易|医药|药业|生物|医疗|汽车|通信|数字|数科|智能|商用厨具|饮料|食品|农牧|农牧食品|机器人|电气|电器|新能源|新材料|重工|机械|工程|建设|环保|环境|文化|传媒|教育|艺术培训学校|培训学校|咨询|石油技术)+?(?:集团)?(?:股份)?(?:有限责任公司|有限公司)(?:[\u4e00-\u9fff]{2,15}(?:分公司|支公司))?$', '', base)
        for s in (s0, s1, s2):
            if len(s) >= 2:
                stems.add(s)
            s_nocity = re.sub(r'^(?:北京|上海|天津|重庆|广东|江苏|浙江|山东|四川|湖北|湖南|河南|河北|福建|安徽|陕西|辽宁|江西|广西|云南|贵州|山西|内蒙古|吉林|黑龙江|新疆|甘肃|海南|宁夏|青海|西藏|深圳|广州|杭州|南京|苏州|武汉|成都|西安|济南|青岛|宁波|厦门|长沙|郑州|合肥|福州|无锡|东莞|佛山|烟台|威海|潍坊|淄博|临沂|济宁|泰安|德州|聊城|滨州|菏泽|枣庄|东营|日照|常州|南通|徐州|扬州|盐城|泰州|镇江|淮安|连云港|宿迁|温州|嘉兴|湖州|绍兴|金华|台州|丽水|衢州|舟山|芜湖|蚌埠|马鞍山|泉州|漳州|南昌|赣州|九江|上饶|宜春|吉安|株洲|湘潭|岳阳|常德|衡阳|珠海|汕头|惠州|中山|江门|湛江|肇庆|清远|桂林|柳州|南宁|海口|三亚|贵阳|遵义|昆明|拉萨|兰州|西宁|银川|乌鲁木齐|大连|沈阳|长春|哈尔滨|石家庄|保定|唐山|太原|呼和浩特|包头|昌邑|莘县)市?(?:[\u4e00-\u9fff]{1,4}[区县])?', '', s)
            if len(s_nocity) >= 2:
                stems.add(s_nocity)
    blacklist = {'公司', '集团', '科技', '有限', '控股', '实业', '国际', '中国', '山东', '北京', '上海', '深圳', '广州', '杭州', '江苏', '浙江', '广东', '信息', '网络', '软件', '电子', '医药', '医疗', '生物', '汽车', '教育', '投资', '管理', '发展', '银行', '证券', '保险', '物业', '商贸', '食品'}
    for st in stems:
        if st in blacklist:
            continue
        if len(st) >= 3 and st in haystack:
            return True
        if len(st) == 2 and re.search(rf'{re.escape(st)}(?:集团|股份|20\d{{2}}|校园|校招|秋招|春招|招聘|全球|[（(|\s—\-·])', title):
            return True
    return False


def refine_company_facts(job):
    row = dict(job)
    text = row.get('body', '')
    title = row.get('title', '')
    compact = lambda value: re.sub(r'\s+', '', value or '').translate(str.maketrans('（）', '()'))
    company = (row.get('company') or '').strip()
    row['company'] = company
    if not company and row.get('company_original') and row.get('company_note') == '来源单位字段与公告未能对应，企业名称待核对。':
        company = (row['company_original'] or '').strip()
        row['company'] = company
        row.pop('company_conflict', None)
        row.pop('company_note', None)
    if re.fullmatch(r'[0-9]{2}[0-9A-Z]{16}', compact(company)):
        row.setdefault('company_original', company)
        row.update(company='', company_conflict=True,
                   company_note='来源单位字段为机构识别码；企业名称需按公告核实。')
        company = ''
    aliases = re.findall(r'([\u4e00-\u9fffA-Za-z0-9（）()·]{3,60}(?:有限责任公司|有限公司))\s*[（(]以下简称[：: ]*[“「\"]([^”」\"]{2,30})[”」\"]', text)
    candidates = {name for name, alias in aliases if compact(alias) in compact(title) and alias not in {'公司', '集团', '本公司', '企业'}}
    match = TITLE_EMPLOYER_PAT.match(title.strip())
    host_school = (row.get('source_name') or '').split('·')[0].strip()
    if match and not re.search(r'招聘|简章|公告|启事|双选会|宣讲会|高层次人才|急需紧缺', match[1]) and match[1] != host_school:
        candidates.add(match[1])
    title_employer = re.split(r'20\d{2}|校园招聘|招聘', compact(title), maxsplit=1)[0]
    introductions = re.findall(
        r'(?:^|\n)[ \t]*(?:[一二三四五六七八九十\d]+[、.．][ \t]*)?'
        r'[【\[]?(?:公司|企业|单位)(?:简介|介绍)[】\]]?[：: \t]*\n?[ \t]*'
        r'([\u4e00-\u9fffA-Za-z0-9（）()·]{2,60}?(?:有限责任公司|有限公司))'
        r'(?=[（(，,。\s]|是|为|成立|$)', text)
    if len(title_employer) >= 4 and job.get('kind', '招聘公告') != '具体岗位':
        for name in introductions:
            stem = re.sub(r'(?:股份)?(?:有限责任公司|有限公司)$', '', compact(name))
            if stem.endswith(title_employer):
                candidates.add(name)
    replacement = next(iter(candidates)) if len(candidates) == 1 else ''
    conflict = bool(company and row.get('source_id', '').endswith('-announcements') and not company_matches_announcement(company, title, text))
    if replacement and (not company or conflict) and compact(replacement) != compact(company):
        row['company'] = replacement
        row['company_note'] = '企业名称按公告标题、明确简称或公司简介中的对应关系整理。'
        if company:
            row.setdefault('company_original', company)
            row['company_conflict'] = True
    elif conflict:
        row['company'] = ''
        row['company_original'] = company
        row['company_conflict'] = True
        row['company_note'] = '来源单位字段与公告未能对应，企业名称待核对。'
    return row
