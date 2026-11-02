# Linux 宿主机部署

## 首次

准备 Docker/Compose、宿主机 Nginx、curl、bash、flock（util-linux）、systemctl；不需 Node/pnpm。独立 PostgreSQL 配好持久化、TLS 和备份。复制 deploy 到 /opt/zhian，配置 .env.production（chmod 600），设置只读 GHCR login，配置 DNS/HTTPS，再安装 nginx/api.conf.example。
API 只绑定 127.0.0.1:3000；数据库禁止公网开放；不暴露 Docker Socket。Nginx 80 重定向 HTTPS，443 代理 API。

## 更新

./deploy.sh v1.0.1：校验版本/权限/环境 → 文件锁 → 保存当前成功配置 → 拉取镜像 → 迁移（失败保留旧实例）→ 启动 → HTTP /ready → nginx -t → systemctl reload nginx → 保存 current/previous 与历史。日志不含凭证。

## 失败

启动/就绪/Nginx 失败尝试用已保存 Compose 和 env 恢复旧版，再检查 /ready；保留错误日志，退出非零；不更新最后成功版本。首次部署没有旧版本时明确报错，不声称回滚成功。

## 回滚

./rollback.sh 或 ./rollback.sh v1.0.0。回滚前必须确认目标应用兼容当前数据库，设置明确的兼容确认；不执行降级迁移。自动恢复仅用于当前发布的兼容性前提。数据库恢复单独维护和审批。

实际执行：`sudo env CONFIRM_DB_COMPATIBLE=yes ./rollback.sh [vX.Y.Z]`。只能回到本服务器保存过的成功快照；不存在快照时拒绝，避免将当前 env/Compose 错配历史程序。每次部署先将 tag 解析为 GHCR digest，再把 digest、Compose、env 保存至 state/snapshots；即使历史 tag 被重建，也使用当时的摘要。若摘要已被仓库清理，需先恢复包再回滚。

## 代理与限流

Nginx 模板覆盖 X-Real-IP 和 X-Forwarded-For，不信任客户端传入值。API 仅在 socket 对端匹配 TRUSTED_PROXY_IPS 时使用 X-Real-IP 进行每 IP 限流。Docker Compose bridge 地址不是固定值：用 `docker network inspect` 确认实际 gateway，配置其精确 IPv4/映射 IPv6，不能填整个公网或无条件信任转发头。未配置时按 socket IP 限流，代理后用户会共享额度。多实例应改用集中式限流存储。

## 首次文件准备示例

将已审阅的 deploy 目录传到 `/opt/zhian`（不要从未知 URL 管道执行脚本）：

```bash
cd /opt/zhian
sudo cp .env.production.example .env.production
sudo chmod 700 /opt/zhian
sudo chmod 600 .env.production
sudo chown root:root .env.production
sudo chmod 700 deploy.sh rollback.sh
# 用受信任编辑器填写全部生产值，不把密钥写入命令历史。
# 完成只读 GHCR login、DNS/证书、宿主机 Nginx 配置及数据库备份。
sudo nginx -t
sudo ./deploy.sh v1.0.0
```

模板含 ssl_certificate 路径，首次安装前必须准备证书，否则 nginx -t 会失败。推荐 study.example.com 与 api.example.com 同站子域，CORS 填完整 HTTPS origin（无尾斜杠），Web 构建变量包含 `/api/v1`。不把数据库加入 API Compose，不开放公网 PostgreSQL 端口。

## 数据库备份

使用 scripts/backup-db.sh 将 pg_dump 自定义格式保存到受限目录，再加密同步异地。恢复先新建库，pg_restore --no-owner，运行冒烟查询，停写后切换连接。每次破坏性变更前演练；禁止自动清库。

## 安全与运维

服务器凭证只读包权限；环境文件不入 Git；不自动 prune 镜像；磁盘与连接数监测。Nginx 证书续期由宿主机管理。部署为短暂替换单实例，不宣称零停机；后续可升级双槽蓝绿。
