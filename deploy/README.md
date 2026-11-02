# 服务器操作入口

详见 [服务器部署手册](../docs/SERVER_DEPLOYMENT.md)。以下命令在 Linux 宿主机执行。

首次：复制 deploy 目录到受限目录，准备 Docker、Compose、Nginx、curl、flock、systemd。建立独立数据库、域名和 TLS。将 .env.production.example 复制为 .env.production，替换全部占位，root 所有且权限 600。GHCR 私有包使用只读凭证执行 docker login（不写入脚本）。

```
sudo ./deploy.sh v1.0.0
sudo ./deploy.sh v1.0.1
sudo env CONFIRM_DB_COMPATIBLE=yes ./rollback.sh
sudo env CONFIRM_DB_COMPATIBLE=yes ./rollback.sh v1.0.0
```

版本只接受 vX.Y.Z，不接受 latest。配置不作为 Shell 执行；部署全程互斥。迁移失败不替换旧实例。切换后失败恢复最近成功的镜像、Compose 与环境快照，再做 HTTP 与 Nginx 校验。成功快照与日志均使用 077 umask。数据库不随应用回滚。

state/current 指向最后成功快照，state/previous 指向上一次成功快照，state/history.tsv 记录结果。这些目录包含受限环境配置，不能提交或公开。保留恢复所需历史镜像，不运行自动 prune。脚本当前是单实例替换，会有短暂切换窗口；不是蓝绿零停机方案。

镜像 tag 拉取后解析为不可变 digest。指定版本回滚要求已有成功快照，恢复对应 digest、Compose 和 env。配置 TRUSTED_PROXY_IPS 为实际 Docker bridge 对端地址，Nginx 必须覆写 X-Real-IP。10个隔离模拟场景已通过；真实宿主机 Nginx 和远程 GHCR 尚未验收。
