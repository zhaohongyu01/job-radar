# 前端可观测性与隐私安全埋点指南（Workers Logs）

本项目采用**零额外成本、零个人数据（Zero-PII）**的前端可观测方案：客户端通过 `navigator.sendBeacon`（降级为 `fetch(..., { keepalive: true })`）向 `/api/rum` 发送脱敏指标，服务端校验通过后写入 `console.log(JSON.stringify({ rum: ... }))`，由 Cloudflare Workers Logs 免费采集与检索。

---

## 一、在 Cloudflare 面板查看 Workers Logs

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 进入左侧菜单 **Compute (Workers) -> Workers & Pages**，点击部署服务 `sites-project`。
3. 切换到 **Observability（可观测性） -> Logs（日志）** 标签页（首次查看需确认开启免费的 Workers Logs）。
4. 在过滤栏中可按 JSON 结构化字段筛选，例如：
   - 查看所有前端异常：`rum.type = "error"`
   - 查看核心体验指标：`rum.type = "vital"`
   - 查看考编工作台事件：`rum.page = "/exams" AND rum.type = "event"`

---

## 二、日志字段字典与隐私边界

每条上报记录经 `app/api/rum/route.ts` 严格白名单校验（请求体上限 `4 KB`，仅接受 `application/json`，丢弃一切额外字段，不读取或记录客户端 IP / User-Agent / Cookie）：

```json
{
  "rum": {
    "type": "event",
    "name": "open_detail",
    "page": "/",
    "ts": 1762700000000
  }
}
```

| 字段 | 类型 | 取值范围 / 约束 | 含义 |
|---|---|---|---|
| `rum.type` | `string` | `'error' \| 'vital' \| 'event'` | 上报类别：运行时错误、Web Vitals 指标或关键交互事件 |
| `rum.name` | `string` | `1–60` 字符（去换行） | 错误摘要/digest、指标名（`LCP` / `CLS`）或固定事件名 |
| `rum.value` | `number`（可选） | 有限数值 | 仅 `vital` 使用：`LCP` 单位为毫秒（整数），`CLS` 为累计布局偏移分值 |
| `rum.page` | `string` | `'/' \| '/exams'` | 归一化页面路径（求职工作台 `/` 或考公考编工作台 `/exams`，不含查询参数） |
| `rum.ts` | `number` | 毫秒时间戳 | 客户端事件发生时间（`Date.now()`） |

### 采样策略（`lib/rum.ts`）
- **`error`**：**100% 全量上报**（包括 `app/error.tsx`、`app/global-error.tsx`、`window.onerror` 与 `unhandledrejection`）。
- **`vital` 与 `event`**：**20% 按会话采样**（首次进入会话时在 `sessionStorage['job-radar-rum-sample-v1']` 生成 `[0, 1)` 随机数，小于 `0.2` 的会话完整上报该会话内所有 `vital` 与 `event`，保证同一会话的转化漏斗不断裂）。

---

## 三、关键事件清单与漏斗统计方法

所有业务事件仅上报固定事件名，**绝不上报搜索词、岗位 ID、公告 ID 或用户画像内容**：

| 事件名 (`rum.name`) | 触发时机 | 适用页面 |
|---|---|---|
| `search` | 搜索框输入防抖结束且检索词非空时 | `/`、`/exams` |
| `open_detail` | 打开岗位详情抽屉或考编公告详情抽屉时 | `/`、`/exams` |
| `click_apply` | 点击「前往投递」或「前往报名」外链按钮时 | `/`、`/exams` |
| `save` | 收藏岗位、收藏招考公告或加入候选岗位时 | `/`、`/exams` |
| `switch_workspace` | 在顶栏或手机底部导航切换「企业求职 ↔ 考公考编」时 | `/`、`/exams` |
| `export_backup` | 成功导出本机 JSON 备份文件时 | `/` |
| `exam_profile_set` | 在考编工作台设置或修改「我的报考条件」后 | `/exams` |

### 漏斗统计示例（Workers Logs Query Builder）

由于采样按会话固定为 20%，各环节事件计数可直接按比例计算转化率（估算全量时乘以 `5`）：

1. **详情浏览 → 投递/报名点击率**：
   - 在 Query Builder 中设 `rum.type = "event"`，按 `rum.page` 与 `rum.name` 分组统计计数（`COUNT`）。
   - 计算 `COUNT(click_apply) / COUNT(open_detail)` 即可分别对比求职端（`/`）与考编端（`/exams`）的投递意愿转化率。
2. **搜索 → 详情打开率**：
   - 比较同一时间窗口内 `COUNT(open_detail)` 与 `COUNT(search)` 的比值；若 `search` 陡增而 `open_detail` 下降，说明检索相关性或数据源覆盖可进一步优化。
3. **Web Vitals 监控（LCP / CLS）**：
   - 筛选 `rum.type = "vital" AND rum.name = "LCP"`，查看 `P75(rum.value)`（目标 `< 2500 ms`）。
   - 筛选 `rum.type = "vital" AND rum.name = "CLS"`，查看 `P75(rum.value)`（目标 `< 0.1`）。

---

## 四、可选：开启免费 Cloudflare Web Analytics

如需查看独立访客数（UV）、PV 与地域分布，可在 Cloudflare Dashboard -> **Analytics & Logs -> Web Analytics** 免费创建站点并获取Site Token，然后在构建/部署环境变量中配置：

```bash
NEXT_PUBLIC_CF_BEACON_TOKEN=<你的_Token>
```

`app/layout.tsx` 仅当 `NEXT_PUBLIC_CF_BEACON_TOKEN` 非空时才会以 `defer` 方式注入官方 `beacon.min.js`；未配置时不加载任何第三方脚本。
