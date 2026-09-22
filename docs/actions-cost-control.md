# Actions 分钟控制

## NAS 独立流水线与排查入口

高校采集采用独立解耦工作流 `NAS Universities Pipeline`（`.github/workflows/nas-universities.yml`），由其专程调度自建 NAS Runner。

- 排查入口：进入 Actions → NAS Universities Pipeline → Run workflow，勾选“仅诊断 NAS 基线下载”，运行即可。此选项只在云端准备高校基线并在 NAS 测试下载与 SHA256 校验；不采集、不构建、不发布。
- 诊断任务按运行 ID 隔离临时目录，在摘要查看解压文件大小、记录数、下载及校验耗时。
- 独立解耦保障：主站日常流水线（`Daily Job Radar Pipeline`）在每天 05:00 和 14:00 自动触发，5 个通用分类 100% 运行在 GitHub 云端，完全不受 NAS 在线状态影响，10~15 分钟无人值守准时发布；NAS 离线时主站自动完整保留线上高校历史数据。

- 推送 main：只运行 `Push Checks`（Python 编译检查、前端单测, lint、类型检查与生产打包）。文档变更不触发；连续推送取消旧检查。不采集、不部署。
- `Daily Job Radar Pipeline`：每天北京时间 05:00、14:00 采集 5 个通用分类并验证发布。
- `NAS Universities Pipeline`：每天北京时间 04:00、13:00（比主站提前 1 小时）在 NAS 直连采集 SDEI 高校并增量合并发布。
- 手动只发页面：在 Daily Job Radar Pipeline 勾选 `deploy_only`。读取线上快照及其全部详情、搜索分片并校验哈希，失败即停止，不使用仓库旧数据兜底。
- 如需临时停用定时，可把仓库 Actions variable `RUN_SCHEDULED_COLLECTION` 设为字符串 `false`，暂时停止定时运行；手动入口仍可用。恢复时删除变量或改为 `true`。

## NAS 执行方式

高校采集独立运行在标签为 `self-hosted, linux, job-radar-nas` 的 NAS Runner 上，每次从云端拉取经过裁剪的 `collector-baseline-universities-b` 基线（仅含高校历史与共享冷却状态），采集完成后由云端合并校验并部署至 Cloudflare Workers。
NAS 离线时，仅 `NAS Universities Pipeline` 会处于排队或等待状态，主站 5 大分类的定时更新发布完全不受任何干扰。

## 费用边界

本次未修改账户预算或支付设置。免费额度按云端各 job 的运行分钟累加，不能把整轮墙钟时间当作计费时间。减少定时频次会降低更新频率，且不保证剩余 200 分钟一定能用到月末；应结合新运行实际用量决定是否暂时关闭定时任务。

需要严格避免超额付费时，在 GitHub 账户 Billing 的 Actions 预算中确认超额停止使用设置。工作流代码不负责设置账单上限。
# 复用一次已完成的采集来修复发布

当采集分片全部成功、最后发布失败时，可在提交修复后手动运行 Daily Job Radar Pipeline：

- `reuse_run_id` 填运行 URL 中的数字 ID（不是页面显示的 #86）。本次为 `35697829191`。
- 不勾选 `deploy_only` 和 `baseline_diagnostic`；高校采集开关在恢复模式下不启动采集。
- 工作流下载该轮完整基线及六个分片，用当前代码检查、重新合并并发布。缺少分片或代际不匹配会拒绝恢复。
- 产物保留 2 天，需在过期前操作。正常每日定时采集不受影响。

列表和全文搜索现按约 4 MiB 分片，保持全部记录及字段。每个生成或发布文件检查 Workers 25 MiB 上限；异常大单条记录不会被静默删除。
