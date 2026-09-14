"""Unit tests for position and attachment table extraction."""
import io
import unittest

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

try:
    import openpyxl
except ImportError:
    openpyxl = None

try:
    import fitz
except ImportError:
    fitz = None

from scripts.parse_positions import (
    clean_cell,
    split_majors,
    parse_table_grid,
    parse_html_tables,
    parse_excel_bytes,
    parse_pdf_bytes,
    extract_positions_from_text,
    enrich_job_with_positions,
)


class TestParsePositions(unittest.TestCase):

    def test_clean_cell_and_split_majors(self):
        self.assertEqual(clean_cell('  软件开发   工程师 \n '), '软件开发 工程师')
        self.assertEqual(clean_cell(None), '')
        self.assertEqual(clean_cell(123), '123')

        majors = split_majors('计算机科学与技术、软件工程，信息安全；人工智能等')
        self.assertIn('计算机科学与技术', majors)
        self.assertIn('软件工程', majors)
        self.assertIn('人工智能', majors)
        self.assertNotIn('等', majors)

    def test_parse_horizontal_html_table(self):
        html = """
        <table>
            <tr>
                <th>序号</th>
                <th>招聘岗位</th>
                <th>需求专业</th>
                <th>学历要求</th>
                <th>招聘人数</th>
                <th>工作地点</th>
            </tr>
            <tr>
                <td>1</td>
                <td>AI算法工程师</td>
                <td>计算机、数学、人工智能</td>
                <td>硕士研究生及以上</td>
                <td>5人</td>
                <td>济南</td>
            </tr>
            <tr>
                <td>2</td>
                <td>财务管理岗</td>
                <td>会计学、财务管理、审计学</td>
                <td>本科及以上</td>
                <td>2人</td>
                <td>青岛</td>
            </tr>
        </table>
        """
        positions = parse_html_tables(html)
        self.assertEqual(len(positions), 2)
        self.assertEqual(positions[0]['name'], 'AI算法工程师')
        self.assertIn('计算机', positions[0]['majors'])
        self.assertEqual(positions[0]['education'], '硕士研究生及以上')
        self.assertEqual(positions[0]['count'], '5人')
        self.assertEqual(positions[0]['city'], '济南')

        self.assertEqual(positions[1]['name'], '财务管理岗')
        self.assertIn('会计学', positions[1]['majors'])
        self.assertEqual(positions[1]['city'], '青岛')

    def test_parse_multi_row_header_html_table(self):
        html = """
        <table>
            <tr>
                <th rowspan="2">岗位名称</th>
                <th colspan="2">资格要求</th>
                <th rowspan="2">工作地点</th>
            </tr>
            <tr>
                <th>需求专业</th>
                <th>学历要求</th>
            </tr>
            <tr>
                <td>审计岗</td>
                <td>审计学</td>
                <td>本科</td>
                <td>济南</td>
            </tr>
        </table>
        """
        positions = parse_html_tables(html)
        self.assertEqual(len(positions), 1)
        self.assertEqual(positions[0]['name'], '审计岗')
        self.assertEqual(positions[0]['majors'], ['审计学'])
        self.assertEqual(positions[0]['education'], '本科')
        self.assertEqual(positions[0]['city'], '济南')

    def test_parse_vertical_kv_html_table(self):
        html = """
        <table>
            <tr>
                <td>职位名称</td>
                <td>橡胶配方研发工程师</td>
            </tr>
            <tr>
                <td>招聘人数</td>
                <td>3人</td>
            </tr>
            <tr>
                <td>学历要求</td>
                <td>硕士研究生</td>
            </tr>
            <tr>
                <td>工作地点</td>
                <td>威海</td>
            </tr>
        </table>
        """
        positions = parse_html_tables(html)
        self.assertEqual(len(positions), 1)
        self.assertEqual(positions[0]['name'], '橡胶配方研发工程师')
        self.assertEqual(positions[0]['count'], '3人')
        self.assertEqual(positions[0]['education'], '硕士研究生')
        self.assertEqual(positions[0]['city'], '威海')

    @unittest.skipUnless(openpyxl is not None, 'openpyxl is not installed')
    def test_parse_excel_bytes(self):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = '岗位需求表'
        ws.append(['序号', '单位名称', '职位名称', '需求专业', '最低学历', '需求人数', '工作城市'])
        ws.append([1, '浪潮集团', '云计算开发架构师', '计算机科学、软件工程', '硕士', '10', '济南'])
        ws.append([2, '浪潮集团', '硬件测试工程师', '电子信息、通信工程', '本科', '5', '青岛'])
        
        buf = io.BytesIO()
        wb.save(buf)
        positions = parse_excel_bytes(buf.getvalue(), filename='2027校招岗位需求表.xlsx')

        self.assertEqual(len(positions), 2)
        self.assertEqual(positions[0]['name'], '云计算开发架构师')
        self.assertIn('软件工程', positions[0]['majors'])
        self.assertEqual(positions[0]['city'], '济南')
        self.assertEqual(positions[0]['source_file'], '2027校招岗位需求表.xlsx')

    @unittest.skipUnless(fitz is not None, 'fitz (PyMuPDF) is not installed')
    def test_parse_pdf_bytes_tabular(self):
        doc = fitz.open()
        page = doc.new_page()
        table_data = [
            (70, ['岗位名称', '需求专业', '学历要求', '工作地点', '人数']),
            (95, ['大数据研发岗', '计算机科学', '硕士', '济南', '3人']),
            (120, ['网络运维岗', '信息安全', '本科', '青岛', '2人']),
        ]
        for y, row in table_data:
            for i, text in enumerate(row):
                page.insert_text((60 + i * 90, y), text, fontname='china-s')
        pdf_bytes = doc.tobytes()

        positions = parse_pdf_bytes(pdf_bytes, filename='测试岗位表.pdf')
        self.assertEqual(len(positions), 2)
        self.assertEqual(positions[0]['name'], '大数据研发岗')
        self.assertEqual(positions[0]['city'], '济南')
        self.assertEqual(positions[1]['name'], '网络运维岗')
        self.assertEqual(positions[1]['city'], '青岛')

    def test_extract_positions_from_text(self):
        text = """
        本次校园招聘具体岗位需求如下：
        岗位名称 | 需求专业 | 学历要求 | 工作地点 | 招聘人数
        机械设计工程师 | 机械工程、机电一体化 | 本科及以上 | 烟台 | 5人
        电气控制工程师 | 电气自动化 | 本科 | 潍坊 | 3人
        """
        positions = extract_positions_from_text(text)
        self.assertEqual(len(positions), 2)
        self.assertEqual(positions[0]['name'], '机械设计工程师')
        self.assertIn('机械工程', positions[0]['majors'])
        self.assertEqual(positions[0]['city'], '烟台')
        self.assertEqual(positions[1]['name'], '电气控制工程师')
        self.assertEqual(positions[1]['city'], '潍坊')

    def test_enrich_job_with_positions(self):
        job = {
            'id': 'test-1',
            'title': '某集团2027届校园招聘公告',
            'company': '某大型企业集团',
            'cities': [],
            'location_evidence': [],
            'directions': [],
        }
        positions = [
            {
                'name': 'Java研发工程师',
                'majors': ['计算机', '软件工程'],
                'education': '本科',
                'count': '5',
                'city': '济南',
            },
            {
                'name': '审计专员',
                'majors': ['审计学', '会计'],
                'education': '硕士',
                'count': '2',
                'city': '青岛',
            },
        ]
        enriched = enrich_job_with_positions(job, positions)
        self.assertEqual(enriched['position_count'], 2)
        self.assertEqual(len(enriched['positions']), 2)
        self.assertIn('计算机', enriched['majors'])
        self.assertIn('审计学', enriched['majors'])
        # Cities auto-enriched
        self.assertIn('济南', enriched['cities'])
        self.assertIn('青岛', enriched['cities'])
        # Directions auto-enriched
        self.assertIn('技术 / 研发', enriched['directions'])
        self.assertIn('财务 / 经济', enriched['directions'])


if __name__ == '__main__':
    unittest.main()
