# Gemini 改动审阅后的修复记录（2026-10-28）

基线 `58ad723`；保留已有 Gemini 未提交修改，在其基础上修复审阅发现的 R1–R8。本文记录本地实现与验证，尚未提交、推送、部署，也未触发新一轮采集。

后续同日已继续实施日历续页、小首片与日程折叠筛选，见 [后续改进记录](priority-improvements-20261028.md)；下文保留前一批的验证口径。

## 行为与边界

| 问题 | 修复后的行为 | 主要实现 |
| --- | --- | --- |
| R1 半份数据冒充完整结果 | 首次加载的卡片放在独立“首批预览”；完整索引通过格式、数量及 ID 唯一性校验后才显示全局计数、个人列表和日程。冷启动失败撤下预览；刷新失败保留上次完整快照 | `lib/snapshot-loader.ts`、`app/page.tsx` |
| R2 慢详情在索引收齐时失效 | 同一次首次加载的预览与完整索引共用详情请求代次；换快照才清缓存、隔离迟到响应 | `app/page.tsx` |
| R3 分享被接收方本地筛选污染 | 网址按完整筛选状态解析；支持所有 Filters 字段往返，多城市与单城市统一恢复。`f=1` 区分显式默认筛选和无网址条件的普通访问 | `lib/browsing.ts`、`app/page.tsx` |
| R4 宣讲标题丢失 | 企业字段为空时保留原活动标题，日程与 ICS 导出一致 | `lib/jobs.ts`、`components/action-rail.tsx` |
| R5 部门误当企业、标题造公司 | 仅从注册的官方海信/海尔来源补充品牌，部门独立保留；卡片、详情、搜索和可选企业分组一致。未知来源不猜品牌；法定实体与分支名称保留 | `config/employer-brands.json`、`scripts/employer_identity.py`、`scripts/collect.py`、`lib/jobs.ts`、`lib/grouping.ts` |
| R6 多城市提示夸大匹配 | 工作地提示只列本条实际匹配的城市，可能覆盖与相关宣讲地点分别展示 | `components/job-card.tsx` |
| R7 旧 ID 分享失效 | 先匹配主 ID，再匹配 `duplicate_ids`；等后续分片后再解析。暂不存在的 ID 保留在网址并说明，避免静默抹掉链接 | `lib/jobs.ts`、`app/page.tsx` |
| R8 综合误归企业 | 增加“单位性质未明确”，容纳综合和空性质；不自动算入企业。旧本地与网址“综合”选项兼容迁移 | `lib/jobs.ts`、`lib/browsing.ts`、`components/filter-sidebar.tsx` |

保留并验证 Gemini 的顶部计数样式修正、已选城市标签、放宽条件时保留城市及分享入口。没有整体重做 Claude 界面。

`employer_brand` / `company_department` 是新增派生字段，原 `company`、岗位 ID、来源、首次收录、更新及核验时间不由离线补字段刷新。官方来源映射与 `collect.SOURCES[*].institution` 自动核对；公开投影及重新导出可补充旧记录，无须逐条重新访问官网。企业分组仅影响启用该选项时的展示，组内每条原记录与投递/收藏身份保留。

网址只含筛选条件和岗位 ID，不包含个人备注、投递记录或收藏内容。`view=saved`、`onlyUnread` 等条件会在打开者自己的本地记录上执行，不会获得分享者的个人记录。浏览器前进/后退也恢复条件；禁用本地存储时仍能使用网址条件。

## 性能与采集耗时

- 没有增加源站请求、来源数、页数、依赖安装或 NAS 采集预算；本轮无需重新部署 NAS 容器。
- 品牌补充读取本地配置并按记录匹配；本地小样本离线导出已验证，但未测量真实 NAS 整轮时间，不能承诺固定秒数。
- 首片可先预览最多 10 张匹配卡片；后续分片并发上限仍为 4。预览不参与全站统计，搜索完整全文仍等待完整索引。
- 仍会下载和解析全部索引，尚未实施“精简卡片字段 / 完整字段按需取”的导出架构。这次不宣称解决全量传输与内存上限，也没有以减少机会数量换速度。
- 未新增订阅后端、邮件、Web Push、企业独立页或整体界面降噪；这些是后续产品范围。

## 本地验收

通过 82 项定向前端测试、7 项定向 Python 测试、15 项实际 Edge 隔离浏览器场景，及 lint、TypeScript、生产构建。按交接要求未执行本地全量测试；现有 CI 配置保持不变。

浏览器场景包括冷启动后续片失败、重复 ID、详情慢于索引、暖刷新失败保留旧结果、跨快照迟到详情、接收方偏好隔离、存储不可用、旧 ID / 缺失 ID、浏览器历史、空企业活动标题、多城市提示、真实海信部门样本，以及 1440px / 390px 无页面横向溢出。测试请求被本地路由拦截，不访问源站或生产站，不写用户浏览器配置。

在 `web/` 执行：

```powershell
node --experimental-strip-types --test tests/snapshot-loader.test.ts tests/browsing.test.ts tests/domain.test.ts tests/grouping.test.ts tests/multicity-workspace.test.ts tests/radar.test.ts tests/calendar-export.test.ts tests/personal-migration.test.ts tests/workspace.test.ts tests/talk-events.test.ts
python -m unittest discover -s tests -p test_employer_identity.py -v
python -m unittest discover -s tests -p test_reproject_snapshot.py -v
python -m unittest discover -s tests -p test_snapshot_shards.py -v
npm run lint
npx tsc --noEmit
npm run build
```

Python 使用已安装项目 requirements 的 Python 3.12 环境。本机本次使用 `data/implementation-20261026/python312/Scripts/python.exe`；其他机器不应依赖该忽略目录。

浏览器测试另开专用本地服务（勿复用用户正在操作的服务），命令均在 `web/`：

```powershell
$env:JOB_RADAR_PREVIEW_DATA='local'
npm run dev -- --hostname 127.0.0.1 --port 3002
```

在另一个终端，`JOB_RADAR_PLAYWRIGHT` 指向现有 Playwright 模块目录（已安装在项目可解析位置时可省略，不为测试新增项目依赖）：

```powershell
$env:JOB_RADAR_PLAYWRIGHT='现有Playwright模块的绝对路径'
$env:JOB_RADAR_BROWSER_URL='http://127.0.0.1:3002'
$env:JOB_RADAR_BROWSER_OUTPUT='data/review-gemini-20261028/fixes'
node --experimental-strip-types tests/browser-regressions.mjs
```

默认使用系统 Edge，可用 `JOB_RADAR_BROWSER_CHANNEL` 选择已安装的浏览器渠道。测试只接受 localhost / 127.0.0.1，结束关闭隔离浏览器；测试服务由启动者停止。输出报告与截图在 Git 忽略的 `data/`，回归脚本和最小样本随代码保存。

## 发布时的注意点

本轮尚未发布。后续获准发布后，前端修复可随构建生效；旧索引的海信/海尔卡片也能由官方来源映射显示品牌。若要让旧公开索引、全文搜索资产与下载数据都带上新增派生字段，需要用当前代码重新导出已有完整状态，或等待正常采集合并导出。只部署旧产物不会重写其 JSON 字段。继续使用内容哈希资产与先资产、后入口的发布顺序。

原先认证受限、空栏目与旧来源陈旧的问题未因本轮前端修复消失；没有承诺全国岗位或宣讲完整覆盖。
