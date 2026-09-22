# 绿联 NAS：仅为采集容器提供 GitHub 代理

用途：验证并改善 NAS 到 GitHub 仓库及产物存储的传输。使用官方 Mihomo 镜像（ARM64），不启动 TUN、不开放宿主机端口、不更改路由器。现有 runner 保留原注册和数据卷。

## 1. 准备文件

在 NAS 文件管理中新建 `docker/job-radar-proxy`，放入本目录的 compose.yaml。把 config.example.yaml 复制为 config.yaml，使用文本编辑器把占位内容改为你已有服务的 **Clash/Mihomo 兼容订阅地址**，保留引号。订阅含凭据，只保存在 NAS，不发聊天、不提交 Git、不使用第三方在线转换服务。

当前订阅由 NAS 直连下载。若订阅本身不可访问或格式不兼容，需先解决订阅加载，代理不会凭空提供节点。日志可能含订阅信息，分享前请遮蔽。

## 2. 创建代理项目

绿联 Docker → 项目 → 新建，选择该目录及 compose.yaml，启动。网络引用截图中已有的 `job-radar-runner_default`；如你后来改了原项目名称，应以 Docker 网络页面实际名称为准。

不添加端口映射，不选择 host 模式，不给特权。如果镜像拉取失败，先记录错误，无法用尚未启动的代理替自己拉镜像；可后续采用电脑下载并导入镜像。

## 3. 先测试，不修改 runner

进入 **job-radar-nas-runner** 的终端，执行一行：

```sh
curl -I -sS --proxy http://job-radar-proxy:7890 --noproxy '' --connect-timeout 10 --max-time 20 -o /dev/null -w '\nHTTP=%{http_code} CONNECT=%{time_connect}s TLS=%{time_appconnect}s TOTAL=%{time_total}s\n' https://productionresultssa5.blob.core.windows.net/
```

400 等响应说明连接成功，不等于实际文件测速成功。连接拒绝：检查代理容器日志/是否启动；无法解析 job-radar-proxy：检查两个容器是否在上述同一网络；超时：检查订阅加载、节点可用性。不要只在这个终端 export 代理然后期待 Actions 自动继承。

## 4. 测试通过后让 Actions 使用代理

等待当前 runner 任务完成。在**原 runner 项目的 Compose 配置** `universities-runner.environment` 下增加以下条目，保留其他配置，尤其是 runner-state 卷和项目名称：

```yaml
      http_proxy: http://job-radar-proxy:7890
      https_proxy: http://job-radar-proxy:7890
      no_proxy: localhost,127.0.0.1,::1,school.gxjy.sdei.edu.cn
```

更新并重建/重启原 runner 容器，使 runner 进程启动时取得环境变量。不能只修改正在运行的终端环境。原数据卷保留时通常无需重新注册；**不要删除卷或重建为另一个项目**。

规则只将 GitHub 与 Azure Blob 存储交给代理，其他请求直连。正式高校采集步骤还显式设置 NO_PROXY/no_proxy 为 `*`，继续国内直连。设置无需修改 GitHub Secrets，也不会让 NAS 接管家庭其他设备的流量。

## 5. 验证与回退

Actions → Daily Job Radar Pipeline → Run workflow → 勾选“仅诊断 NAS 基线下载”，新建一次运行。检查真实文件下载耗时及校验成功后，再执行完整采集。

若代理不可用：移除原 runner 项目新增的三个环境变量并重启 runner，即恢复原直连；再停止代理容器。不修改现有基线或采集历史。

本部署文件只做静态检查，尚未在用户 NAS 拉取镜像或启动验证。latest 为可变镜像标签，验证成功后建议记录并固定实际镜像 digest。
