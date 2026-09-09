# 绿联云 NAS 部署

这套配置把采集器和网站放进同一个 Docker 容器：容器启动时先采集一次，随后每 24 小时采集一次。采集后会重新构建网站并重启本地 Web Worker，因此不依赖 ChatGPT、Codex 或 Sites 发布额度。

## 需要准备

- 支持 Docker/容器管理的绿联云 NAS；
- NAS 能访问互联网；
- NAS 上预留约 2 GB 空间用于 Node 依赖和构建缓存。

## 启动

把 `web` 文件夹完整复制到 NAS，例如 `/docker/job-radar`，然后在该文件夹执行：

```bash
docker compose -f docker-compose.nas.yml up -d --build
```

容器启动后，在同一局域网访问：

```text
http://NAS局域网IP:8787
```

首次启动会先采集，可能需要几分钟；可以查看日志：

```bash
docker compose -f docker-compose.nas.yml logs -f job-radar
```

## 更新频率

默认是启动时采集一次，然后每 24 小时采集一次。可在 `docker-compose.nas.yml` 中调整：

- `COLLECT_INTERVAL_SECONDS: "86400"`：采集间隔，86400 秒就是 24 小时；
- `COLLECT_PAGES: "20"`：每个来源读取的分页数量；
- `COLLECT_DAYS: "30"`：近期公告窗口。

采集器会保留旧记录并去重，单个来源失败不会清空之前的数据。

## 对外访问

朋友需要从外网访问时，建议使用 Cloudflare Tunnel 或 NAS 自带的 HTTPS 反向代理，并绑定自己的域名。不要直接把 8787 端口裸暴露到公网。

## 注意

容器重启后会重新采集一次，这是预期行为；状态保存在 `data` 目录。当前个人收藏、已投递和隐藏状态仍保存在每个用户自己的浏览器中。
