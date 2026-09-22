# 绿联 DH4300 Plus：高校采集节点

本配置面向 Linux ARM64、支持 Docker、全天开机的 DH4300 Plus。
NAS 只运行 `universities-b`（17 所高校的公告和岗位通道），不构建网站、不部署 Cloudflare。
不需要公网 IP、端口转发、NAS 管理账号交给 GitHub，也不需要把 node_modules 或整个项目复制到 NAS。

## 工作方式

1. 主 Action 在 GitHub 准备本轮历史基线，其他五组来源仍由 GitHub 采集。
2. 开启 NAS 模式后，高校分片触发独立的 `NAS Universities Collector` 工作流。
3. NAS 获取主任务的准确代码提交及 `collector-baseline` 产物，使用国内网络采集。
4. 高校增量产物返回 GitHub，原合并器检查基线版本、来源归属和历史完整性后部署。

网站访问仍是独立问题：这个配置不解决国内访问 workers.dev 的问题，也不依赖 NAS 能打开 workers.dev。

## 先决条件

- 仓库保持私有；只给自己可信的仓库配置此 Runner，不运行外部 PR。
- NAS 所在家庭宽带可以在不使用海外出口的情况下访问高校就业平台。电脑手机热点成功不代表家庭宽带必然成功。
- NAS 可以访问 GitHub、GitHub API、Actions 产物存储、Docker 镜像及 Python 包源。若使用规则代理，只让 GitHub 等需要的流量走代理；高校域名必须直连。路由器全局代理无法被容器 NO_PROXY 修正。
- NAS 至少预留 3 GB 可用内存、约 8 GB 磁盘空间；容器限制 2 核、3 GB 内存。

## 1. 准备小型部署目录

把提供的 `nas-runner-dh4300plus.zip` 解压到 NAS 的一个独立目录，例如共享文件夹中的 `docker/job-radar-runner`。
目录包含：

```text
compose.nas-runner.yml
runner-registration.txt
deploy/nas/Dockerfile
deploy/nas/entrypoint.sh
deploy/nas/README.md
```

这是新的采集节点配置。不要使用旧的 `docker-compose.nas.yml`，旧配置还会构建和托管整个网站。

## 2. 构建镜像，再填写注册令牌

在绿联 Docker 的项目/Compose 功能中选择该目录和 `compose.nas-runner.yml`。
先构建镜像；如果界面只允许一次性构建启动，首次启动会因空令牌退出，这是预期结果。
首次构建需要下载 Python 基础镜像和 GitHub 官方 ARM64 Runner，耗时取决于网络。

在 GitHub 私有仓库进入 **Settings → Actions → Runners → New self-hosted runner**，选择 **Linux / ARM64**。
从页面的配置命令中取 `--token` 后面的短期注册令牌，只把该值写入 NAS 本地 `runner-registration.txt`，然后启动或重启容器。
不要使用账号密码或长期 PAT，也不要将令牌发到聊天或提交 Git。
注册令牌通常一小时后失效，过期就从 GitHub 重新生成。

命令行等价操作（在部署目录内）：

```sh
docker compose -f compose.nas-runner.yml build
# 本地填写 runner-registration.txt 后
docker compose -f compose.nas-runner.yml up -d
docker compose -f compose.nas-runner.yml logs --tail 80
```

Runner 首次注册后保存在 Docker 专用命名卷中，支持 NAS 重启和 Runner 自动更新。
注册成功后可以清空令牌文件，但保留空文件；普通重启不需要新令牌。
不要删除命名卷，否则需要在 GitHub 删除旧 Runner 注册并重新注册。
此容器不映射任何端口，不挂载 Docker socket，不挂载个人文件目录。

## 3. 启用 GitHub 分流

先将本次代码和两个工作流提交并推送到默认分支；本说明不代表已推送。
确认 GitHub Runners 页面出现 **ugreen-dh4300plus / Idle**，带有 `job-radar-nas` 标签。

在 **Settings → Secrets and variables → Actions → Variables** 添加仓库变量：

```text
UNIVERSITIES_B_RUNNER = nas
```

不是 Secret，不要填入令牌。NAS 任务只得到本仓库的临时只读 GitHub 权限，不需要 Cloudflare 密钥。
主工作流在矩阵任务中直接分流：当 `UNIVERSITIES_B_RUNNER=nas` 时，`universities-b` 分片直接调度至 `[self-hosted, linux, job-radar-nas]`。

手动运行一次 **Daily Job Radar Pipeline** 验收。
开启变量后，定时或手动触发均会自动调度高校分片至 NAS。

## 4. 首次验收

- GitHub Actions 的 `collect-shards (universities-b)` 步骤中显示运行于自建 NAS Runner。
- 高校分片下载 `collector-baseline-universities-b` 并生成 `collector-shard-universities-b` 产物，合并步骤正常汇总结算。
- 核对来源列表的实际 `pages / parsed / cached` 和错误，不只看任务绿色状态。
- 首次可能仍处于以前保留的四小时冷却；不要清空历史或强行重试，等冷却结束后再验收。
- 如果仍有 403，检查报告中的 `portal / announcements_list / positions_list` 阶段，并确认家庭宽带和路由器规则。NAS 不保证能解除上游限制。

## 5. 离线、超时和回退

- NAS 执行预算：单源预算 120 秒，分片总预算 1500 秒，Job 超时 45 分钟。
- NAS 离线处理：若 NAS 离线，高校分片会在 GitHub 队列中排队。可取消本轮运行，并在手动运行时取消勾选 `include_universities_b` 选项继续发布其他分片。
- NAS 失败或产物缺失：合并器保留高校历史记录并报告缺失；其他来源有成功核验且完整性通过时可正常发布。
- 要恢复为云端 Runner 采集高校，删除变量 `UNIVERSITIES_B_RUNNER` 或改为非 `nas` 值即可，无需删除历史数据。

## 更新与维护

应用代码每次从父任务指定的提交自动检出，无需反复手工复制项目。
Python 依赖在独立虚拟环境安装，不安装前端依赖。
Runner 使用官方 v2.337.0 包并校验官方 SHA-256；Runner 自身允许自动更新。
更新容器基础系统时重新 build 并 up，保留 `runner-state` 卷。

官方参考：
- https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners
- https://github.com/actions/runner/releases/tag/v2.337.0
- https://store.ugreen.jp/blogs/nas-knowledge/docker-compose-setup-guide
