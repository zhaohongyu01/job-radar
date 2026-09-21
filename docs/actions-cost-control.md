# Actions 分钟控制

- 推送 main：只运行 `Push Checks`（Python 语法、前端 lint 和类型检查）。文档变更不触发；连续推送取消旧检查。不采集、不部署。
- `Daily Job Radar Pipeline`：每天北京时间 16:00 采集、验证和发布一次。原有完整发布校验继续保留。
- 手动只发页面：在该工作流的 **Run workflow** 勾选 `deploy_only`。读取线上快照及其全部详情、搜索分片并校验哈希，失败即停止，不使用仓库旧数据兜底。
- 手动采集：不勾选 `deploy_only`。默认包含高校；NAS 离线时取消 `include_universities_b`，保留高校历史数据。
- 如本月剩余分钟不足，可把仓库 Actions variable `RUN_SCHEDULED_COLLECTION` 设为字符串 `false`，暂时停止定时运行；手动入口仍可用。恢复时删除变量或改为 `true`。

## NAS 执行方式

保持 `UNIVERSITIES_B_RUNNER=nas`，现有 runner 标签 `self-hosted, linux, job-radar-nas` 不变。主工作流的高校分片直接在 NAS 执行，其他分片仍用云端 runner。全部分片从同一次运行的 baseline 开始，合并时继续检查归属与基线一致性。

不再派发并轮询 `NAS Universities Collector` 子工作流。旧入口仅为兼容保留，不要另行启动，否则可能重复采集。GitHub 调度器等待 NAS 不占用一台云端 runner。

**行为变化：NAS 离线时高校任务会排队，原来 90 秒无结果自动降级不再适用。** 若离线，取消本轮后手动运行并取消高校选项。NAS 在线但采集失败时，仍由现有合并规则决定能否保留历史并发布；所有分片均未成功核验时继续拒绝发布。

## 费用边界

本次未修改账户预算或支付设置。免费额度按云端各 job 的运行分钟累加，不能把整轮墙钟时间当作计费时间。减少定时频次会降低更新频率，且不保证剩余 200 分钟一定能用到月末；应结合新运行实际用量决定是否暂时关闭定时任务。

需要严格避免超额付费时，在 GitHub 账户 Billing 的 Actions 预算中确认超额停止使用设置。工作流代码不负责设置账单上限。
