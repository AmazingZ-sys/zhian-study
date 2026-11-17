# 腾讯云 Ubuntu + Docker：知岸后端部署与前后端联调

适用：已有腾讯云 Ubuntu 服务器和 Docker，用同一台服务器运行 PostgreSQL 与 API，前端改为 Vercel 托管。服务器不需要 Node.js 或 pnpm。本文使用已经发布并核验的 `v1.0.2` 镜像，不在服务器重新编译项目。

服务器指南更新：2026-11-03。镜像已通过 CI、数据库容器冒烟和双架构 manifest 校验；以下服务器命令由你执行，尚未在你的实际服务器验收。

## 1. 域名和部署结构

按你的域名安排如下。如果你打算把现有域名留给 API，可以对调命名，但 DNS、证书、CORS 和前端构建地址必须同步替换。

| 用途   | 地址                                 | 部署位置                                |
| ------ | ------------------------------------ | --------------------------------------- |
| 前端   | `https://zhian.amazingzsys.site`     | Vercel 项目 `zhian-study`（已静态验收） |
| 后端   | `https://api.zhian.amazingzsys.site` | 腾讯云宿主机 Nginx → API 容器           |
| 数据库 | `zhian-postgres:5432/zhian`          | 独立 PostgreSQL 容器，仅 Docker 内网    |

浏览器 → Vercel 前端 → HTTPS API → PostgreSQL。API 只发布到宿主机 `127.0.0.1:3000`；数据库不发布宿主机端口。

两个 HTTPS 域名属于同一个站点，可以使用 `SameSite=Lax` Cookie；它们仍是不同 origin，所以还需要 CORS。联调时从自定义前端域名打开，避免用 `vercel.app` 临时域名连接自有 API 时遭遇第三方 Cookie 拦截。

## 2. DNS、安全组和 Vercel 域名

本次 v1.0.2 已通过正式 Actions 发布，`zhian.amazingzsys.site` 已绑定到本项目 Production，用户已自行完成 DNS 切换。2026-11-03 权威服务器 `heron.dnspod.net` 返回下表前端 CNAME；Vercel 确认配置有效且项目已验证，正式域名 HTTPS、入口、深层路由、静态资源和 API 未部署兜底均已验收，响应由 Vercel 提供。

| 主机记录    | 类型  | 记录值                                |
| ----------- | ----- | ------------------------------------- |
| `zhian`     | CNAME | `312f34b1e08dbff2.vercel-dns-017.com` |
| `api.zhian` | A     | 你的腾讯云服务器公网 IPv4             |

前端 CNAME 是本项目的实际目标，不复制其他项目记录；今后调整仍以本项目 **Settings → Domains** 的提示为准。API 子域名继续指向服务器，不添加到 Vercel。没有可用 IPv6 时，不要保留指向旧机器的 AAAA。当前前端 DNS 无待办，完整 API 联调需按下文准备服务器后验收。

腾讯云安全组放行 TCP `80`、`443`，按现有管理方式保留 SSH。不要开放 `3000`、`5432`。主机防火墙已启用时也需要放行 80/443；不要在远程连接时盲目重置或启用防火墙。

下面除第 8 节注明的本地命令外，全部在服务器执行。先登录并进入 root shell：

```bash
ssh ubuntu@你的服务器公网IP
sudo -i
cat /etc/os-release
docker version
docker compose version
ss -lntp
```

确认宿主机 3000 没被其他服务占用。当前端口同时写在 API Compose 的宿主映射、`deploy.sh` 的 `ready()` 检查、本文 Nginx 和宿主 curl 命令中；如已占用，必须同步调整这些宿主地址，不能只改 Compose。容器内部 `PORT=3000` 与容器健康检查不改。80/443 已由 Nginx 管理时新增本站点即可；若由其他代理占用，先适配现有代理，不直接启动另一个 Nginx 抢占端口。本文使用 `docker compose` 插件；不存在时，先按 [Docker 官方 Compose 安装说明](https://docs.docker.com/compose/install/linux/)安装插件，避免另外安装冲突的 Docker。

安装宿主机依赖，不重装已有 Docker：

```bash
apt-get update
apt-get install -y nginx certbot curl ca-certificates openssl dnsutils util-linux
systemctl enable --now nginx
dig +short api.zhian.amazingzsys.site
dig +short zhian.amazingzsys.site
```

API 的解析结果应是当前服务器公网 IP。公网请求被拦截时，检查安全组、主机防火墙和腾讯云控制台提示的域名接入状态。

## 3. 下载部署文件和镜像，建立网络

以下首次安装命令要求 `/opt/zhian`、`/opt/zhian-db` 和 `zhian_postgres_data` 数据卷均不存在。已有配置或数据时改走接入/更新流程，不重新生成密码覆盖。

```bash
umask 077
for directory in /opt/zhian /opt/zhian-db; do
  test ! -e "$directory" || { echo "$directory 已存在，请检查已有部署"; exit 1; }
done
if docker volume inspect zhian_postgres_data >/dev/null 2>&1; then
  echo 'zhian_postgres_data 已存在，请接入原数据库，不要覆盖配置或删除卷'
  exit 1
fi
install -d -m 700 /opt/zhian /opt/zhian-db /opt/zhian-backups
curl --fail --location --retry 3 \
  https://github.com/AmazingZ-sys/zhian-study/archive/refs/tags/v1.0.2.tar.gz \
  -o /tmp/zhian-study-v1.0.2.tar.gz
tar -xzf /tmp/zhian-study-v1.0.2.tar.gz \
  --strip-components=2 -C /opt/zhian zhian-study-1.0.2/deploy
chmod 700 /opt/zhian/deploy.sh /opt/zhian/rollback.sh
docker network create zhian-backend
docker network inspect zhian-backend
```

Docker 自动挑选可用网段。在 API Compose 文件末尾追加一次下面配置，API、一次性迁移容器和数据库会始终接入同一个外部网络：

```bash
cat >> /opt/zhian/docker-compose.prod.yml <<'YAML'

networks:
  default:
    external: true
    name: zhian-backend
YAML
```

不要只手工 `docker network connect` 一个运行中的 API，否则重建或迁移时会丢失网络。部署脚本会把修改后的完整 Compose 保存到成功快照。

确认服务器可以拉取已发布镜像：

```bash
docker pull ghcr.io/amazingz-sys/zhian-study-api:v1.0.2
```

镜像支持 `linux/amd64` 和 `linux/arm64`。2026-11-03 核验的 `v1.0.2` index digest 是（部署脚本仍会按实际拉取结果锁定 digest）：

```text
sha256:0e24c3c52f3a90ff183702ba89d5f3354cb79833649c5dd97b8e095ff14f06fd
```

超时先检查服务器到 GHCR 的网络；明确返回 `unauthorized` 时再核对包权限，按需使用仅有 `read:packages` 的凭据，在当前 root 会话执行 `docker login ghcr.io`。不要把 Token 明文放在命令中，也不用复制 GitHub Actions 的 Token 到服务器。

## 4. 创建独立 PostgreSQL 和生产配置

已有 PostgreSQL 时可跳过数据库创建，把实际连接写入 `.env.production`。远程库按提供方要求使用 TLS，确认 API 容器可达；API 容器里的 `localhost` 指向 API 自己。

下面部署同机 PostgreSQL。管理员使用 `postgres`，应用使用普通角色 `zhian`。在同一个 root shell 中执行本节，随机密码会直接写入权限受限的文件，不需要复制到聊天或代码仓库。

```bash
test ! -e /opt/zhian/.env.production || { echo 'API 配置已存在，不要重新生成密码覆盖'; exit 1; }
test ! -e /opt/zhian-db/.env || { echo '数据库配置已存在，请接入原数据库'; exit 1; }
db_admin_password="$(openssl rand -hex 32)"
db_password="$(openssl rand -hex 32)"
jwt_secret="$(openssl rand -hex 48)"
proxy_gateway="$(docker network inspect zhian-backend --format '{{(index .IPAM.Config 0).Gateway}}')"

cat > /opt/zhian-db/.env <<EOF
POSTGRES_PASSWORD=$db_admin_password
EOF

cat > /opt/zhian/.env.production <<EOF
IMAGE_REPO=ghcr.io/amazingz-sys/zhian-study-api
DATABASE_URL=postgresql://zhian:$db_password@zhian-postgres:5432/zhian?sslmode=disable
JWT_SECRET=$jwt_secret
CORS_ORIGINS=https://zhian.amazingzsys.site
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
NODE_ENV=production
PORT=3000
TRUSTED_PROXY_IPS=$proxy_gateway,::ffff:$proxy_gateway
EOF

chmod 600 /opt/zhian-db/.env /opt/zhian/.env.production
chown root:root /opt/zhian-db/.env /opt/zhian/.env.production
```

同机私网示例的 PostgreSQL 未配置 TLS，使用 `sslmode=disable`；这不适用于跨公网数据库。原 `.env.production.example` 的 `database.internal`、`REPLACE_*` 和 `verify-full` 不能原样用于这里。

创建数据库 Compose，注意没有 `ports`：

```bash
cat > /opt/zhian-db/docker-compose.yml <<'YAML'
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_DB: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks:
      default:
        aliases:
          - zhian-postgres
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d postgres"]
      interval: 5s
      timeout: 3s
      retries: 20
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: "5"

networks:
  default:
    external: true
    name: zhian-backend

volumes:
  pgdata:
    name: zhian_postgres_data
YAML

cd /opt/zhian-db
docker compose --project-name zhian-db up -d --wait
docker compose --project-name zhian-db ps
```

仅对全新空库执行下面一次。psql 从临时环境变量读取应用密码，按 SQL 字符串引用：

```bash
docker compose --project-name zhian-db exec -T \
  -e APP_DB_PASSWORD="$db_password" postgres \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
\getenv app_password APP_DB_PASSWORD
CREATE ROLE zhian LOGIN PASSWORD :'app_password';
CREATE DATABASE zhian OWNER zhian;
SQL

unset db_admin_password db_password jwt_secret proxy_gateway
```

数据库现在有持久卷和一个空的 `zhian` 数据库。**不要执行 `docker compose down -v` 或删除 `zhian_postgres_data`。** 修改 `.env` 不会修改已经初始化的数据库密码，密码轮换要同时修改数据库角色和 API 配置。

`TRUSTED_PROXY_IPS` 填的是宿主机 Nginx 连接 API 时的精确 Docker bridge 对端，用于按真实客户端 IP 限流。普通 Linux bridge 使用查询到的 gateway；改用其他网络或前置代理后需重新核对，不能填整个公网或通配所有代理。

## 5. 配置 Nginx 和 API HTTPS

先配置 HTTP 站点申请证书，再配置 HTTPS。这里新增独立站点，不删除其他 Nginx 配置；已有相同域名配置时先合并，避免重复 `server_name`。

```bash
install -d -m 755 /var/www/certbot
cat > /etc/nginx/conf.d/zhian-api.conf <<'NGINX'
server {
    listen 80;
    server_name api.zhian.amazingzsys.site;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 503;
    }
}
NGINX

nginx -t
systemctl reload nginx
certbot certonly --webroot -w /var/www/certbot \
  --cert-name api.zhian.amazingzsys.site -d api.zhian.amazingzsys.site
```

按 Certbot 提示填写邮箱和同意条款。申请失败先查 DNS、80 端口和 AAAA 记录。证书成功后，写入完整 HTTPS 配置：

```bash
cat > /etc/nginx/conf.d/zhian-api.conf <<'NGINX'
server {
    listen 80;
    server_name api.zhian.amazingzsys.site;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name api.zhian.amazingzsys.site;
    ssl_certificate /etc/letsencrypt/live/api.zhian.amazingzsys.site/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.zhian.amazingzsys.site/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;
    client_max_body_size 3m;
    client_body_timeout 15s;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
NGINX

nginx -t
systemctl reload nginx
```

本文使用兼容 Ubuntu 常见版本的 `listen 443 ssl`。旧示例的 `http2 on` 需要较新的 Nginx，不能直接复制到旧发行版包；联调不依赖 HTTP/2。Nginx 不重复添加 CORS 头，由 API 统一处理。

配置证书续期后的 Nginx reload：

```bash
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/zhian-reload-nginx <<'SH'
#!/bin/sh
/usr/sbin/nginx -t && /bin/systemctl reload nginx
SH
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/zhian-reload-nginx
systemctl status certbot.timer --no-pager
certbot renew --dry-run
```

## 6. 部署 API v1.0.2

```bash
cd /opt/zhian
./deploy.sh v1.0.2
```

脚本校验权限和生产配置、拉取镜像并锁定 digest、执行 Drizzle 迁移、启动 API、检查 `/ready`、重载 Nginx，并保存成功快照。它不会创建数据库、默认账户或演示内容。

```bash
curl --fail --show-error http://127.0.0.1:3000/health
curl --fail --show-error http://127.0.0.1:3000/ready
curl --fail --show-error https://api.zhian.amazingzsys.site/ready
curl --fail --show-error https://api.zhian.amazingzsys.site/api/v1/question-categories
cat /opt/zhian/state/current/version
cat /opt/zhian/state/current/image
```

预期 `/health` 是 `{"status":"ok"}`，`/ready` 是 `{"status":"ready"}`。空库分类接口返回空数据是正常结果。再从自己的电脑访问 HTTPS 地址，确认公网链路也可达。

查看实际容器日志：

```bash
api_container="$(docker ps --filter label=com.docker.compose.project=zhian-api --filter label=com.docker.compose.service=api --format '{{.ID}}')"
docker logs --tail 100 "$api_container"
```

部署日志在 `/opt/zhian/logs/`。`state/` 快照包含生产配置，保持 root 访问，不公开上传；排错时不要发送 `.env.production`、Cookie 或数据库密码。

## 7. 检查 CORS

```bash
curl -i -X OPTIONS \
  https://api.zhian.amazingzsys.site/api/v1/auth/login \
  -H 'Origin: https://zhian.amazingzsys.site' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,x-requested-with'
```

响应应允许预检，并包含：

```text
Access-Control-Allow-Origin: https://zhian.amazingzsys.site
Access-Control-Allow-Credentials: true
```

允许的方法应包括 POST，允许的 header 应包含请求中的两个 header。`CORS_ORIGINS` 填前端 origin，没有末尾 `/`，没有 `/api/v1`；多个已知前端以逗号分隔，不使用 `*`。

## 8. 让 Vercel 前端连接真实 API

必须重新构建前端，修改变量不会改变已发布的 JavaScript。服务器不需要安装前端依赖。

本次已创建并配置实际 Vercel 项目和三项 GitHub Secrets，v1.0.2 已通过正式 Actions 发布至 [zhian-study.vercel.app](https://zhian-study.vercel.app)。后续配置核对：Root Directory 为仓库根目录，Node.js 为 22.x，使用根 `vercel.json` 的 Vite、`pnpm --filter @zhian/web build` 与 `apps/web/dist`；Git 自动部署已由配置关闭。GitHub 仓库或 production Environment 需要实际 `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID` Secrets，旧 Netlify 凭据不能复用为这些值。

打开 [GitHub 仓库 Variables](https://github.com/AmazingZ-sys/zhian-study/settings/variables/actions)，把 `VITE_API_BASE_URL` 设置为：

```text
https://api.zhian.amazingzsys.site/api/v1
```

这里修改的是 **GitHub 仓库变量**；Actions 在 Vercel build 步骤显式注入它。后端数据库和 JWT 密钥不放入前端构建。再选择一种重新发布方式。

### 方式 A：在你的电脑使用已登录 CLI，只发布前端

以下在包含迁移配置的电脑项目目录执行，不在服务器 `/opt/zhian` 执行。若尚未关联项目，`vercel link` 时选择实际账户/团队和 `zhian-study` 项目：

```bash
cd /Users/zhix/Downloads/zhian-study
pnpm install --frozen-lockfile
pnpm exec vercel link
pnpm exec vercel pull --yes --environment=production
VITE_API_BASE_URL=https://api.zhian.amazingzsys.site/api/v1 \
  pnpm exec vercel build --prod
pnpm exec vercel deploy --prebuilt --prod --yes
```

项目移动后换成实际路径。根工程锁定 CLI `65.10.0`；部署上传同一次 build 的预构建产物。发布后验证真实 URL 的入口、深层路由、资源、安全头与 API 地址。此方式只更新前端；后续自动发布使用 GitHub 变量。

### 方式 B：GitHub Actions 发布或重发布迁移后的正式版本

首次 Vercel 发布必须包含迁移提交，不能选择迁移前 `v1.0.0`：旧 tag 没有 Vercel 配置和 CLI。发布包含迁移的正式版本后，需要重试时进入 [Release and deploy](https://github.com/AmazingZ-sys/zhian-study/actions/workflows/release.yml) → **Run workflow** → 选择 `main` → `tag` 填该迁移后正式版本，等待验证和部署完成。

工作流会校验已有正式版本，再使用新变量发布同一 Release SHA 的前端，并保存 URL/版本/SHA 收据；同时还会重建并推送同版本 API 镜像，不创建新 Release，也不自动 SSH 到服务器。镜像 digest 可能变化，已部署服务器继续使用成功快照固定的 digest，不会自动替换。只改前端地址时方式 A 更直接。

Vercel `/api/*` 保留服务未部署的 503 JSON 兜底。绝对 API URL 会直接请求腾讯云 API；变量继续使用 `/api/v1` 会命中兜底。Vercel 静态发布和第 2 节正式域名 DNS/HTTPS 已验收；API 可用后再执行下节完整登录联调，临时 `vercel.app` 不自动加入生产 CORS。

## 9. 浏览器联调、管理员和内容导入

打开 `https://zhian.amazingzsys.site`，依次验收：

1. 注册自己的账户；Network 中请求地址应以 `https://api.zhian.amazingzsys.site/api/v1/` 开头。
2. 登录后刷新页面仍然登录，`/users/me` 返回 200。
3. 开发者工具 Application/Storage → API 域名 Cookie 中检查 `zhian_access`、`zhian_refresh`：`Secure`、`HttpOnly`、`SameSite=Lax`、`Path=/api/v1`。HttpOnly Cookie 不会出现在 `document.cookie` 中。
4. 退出后重新登录；导入内容后完成答题、保存笔记、刷新持久化和模考流程。

生产环境是空库。先在网页注册账户，再在服务器提升管理员。镜像没有 `tsx` 或编译后的 `promote.js`，不要在生产容器执行 `pnpm admin:promote`。本方案用数据库事务提升并记录审计。

先在服务器进入**交互式 psql**：

```bash
cd /opt/zhian-db
docker compose --project-name zhian-db exec postgres \
  psql -U postgres -d zhian -v ON_ERROR_STOP=1
```

进入 psql 后，先只执行下面一行，再按提示输入注册邮箱：

```sql
\prompt '已注册的管理员邮箱: ' admin_email
```

邮箱输入完成、再次出现 psql 提示符后，再粘贴下面的事务。不要把交互提示和后面的 SQL 一次性粘贴，也不要改成 `exec -T` 加 heredoc：

```sql
BEGIN;
WITH promoted AS (
  UPDATE users
  SET role = 'admin', updated_at = now()
  WHERE email = lower(trim(:'admin_email'))
  RETURNING id
)
INSERT INTO audit_logs (user_id, action, object_id, result)
SELECT id, 'admin.promote.server', id::text, 'success' FROM promoted
RETURNING user_id, action;
COMMIT;
\q
```

应看到一行 `admin.promote.server`。若为 `INSERT 0 0`，邮箱没有匹配到账户，先核对注册环境和邮箱。刷新或重新登录后访问 `/admin`，先创建分类，再导入有权使用的题目、岗位和公告。生产镜像明确禁止运行演示 seed；空库不代表部署失败。

## 10. 常见问题

| 现象                                              | 优先检查                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| 请求仍走前端域名 `/api/...` 或 `API_NOT_DEPLOYED` | 前端没用真实 `VITE_API_BASE_URL` 重新构建；检查 GitHub 变量和实际部署 |
| API 域名或证书申请失败                            | A/AAAA、安全组、防火墙、80/443、域名接入状态                          |
| Nginx 502                                         | `curl http://127.0.0.1:3000/ready`、API 日志、端口占用                |
| `/health` 200，`/ready` 503                       | 数据库健康、密码、库名、Docker 网络、`DATABASE_URL` 主机名            |
| `password authentication failed`                  | 数据库角色的实际密码；只改 `.env` 不会改已有数据库密码                |
| `relation ... does not exist`                     | 迁移是否完成，API 是否连错数据库                                      |
| CORS 或 403 来源校验失败                          | `CORS_ORIGINS` 是否等于浏览器的前端 origin；Nginx 有无重复 CORS 头    |
| 登录成功后 `/users/me` 401                        | 是否从自定义 HTTPS 前端打开；Cookie 是否被阻止；SameSite/Secure/Path  |
| `unknown directive http2`                         | 使用本文 Nginx 配置，避免旧模板 `http2 on`                            |
| 用户一起触发限流                                  | `TRUSTED_PROXY_IPS` 对端和 Nginx 的 X-Real-IP 覆写                    |
| 题库或岗位为空                                    | 空生产库没有演示数据，需要管理员维护                                  |

修改 API `.env.production` 后，用 `cd /opt/zhian && ./deploy.sh v1.0.2` 重新部署，配置才生效。修改前端构建变量后，按第 8 节重新发布前端。

## 11. 备份、更新和回滚

每次更新已有数据库前，先在服务器上创建完整逻辑备份。`deploy.sh` 不会自动备份数据库：

```bash
cd /opt/zhian-db
umask 077
backup_path="/opt/zhian-backups/zhian-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose --project-name zhian-db exec -T postgres \
  pg_dump -U postgres -d zhian --format=custom --no-owner > "$backup_path"
test -s "$backup_path"
chmod 600 "$backup_path"
docker compose --project-name zhian-db exec -T postgres \
  pg_restore --list < "$backup_path" > /dev/null
```

备份加密保存到异地，在独立数据库验证恢复；`pg_restore --list` 只能检查可读目录，不能代替恢复演练。

当前已发布 `v1.0.2`；已有旧版部署升级到它时，先完成上面的备份并评估迁移，再运行：

```bash
cd /opt/zhian
./deploy.sh v1.0.2
```

首次部署也是使用 `v1.0.2`；后续只选择实际发布的正式版本，不使用 `latest`。服务器只拉镜像，不构建前端。部署为单实例替换，有短暂切换窗口；迁移失败保留旧 API，切换后失败尝试恢复最后成功的配置和镜像。

确认旧应用兼容当前数据库后，才执行回滚：

```bash
cd /opt/zhian
CONFIRM_DB_COMPATIBLE=yes ./rollback.sh
# 或回到曾在本服务器成功部署、仍有快照的版本：
CONFIRM_DB_COMPATIBLE=yes ./rollback.sh v1.0.0
```

回滚恢复应用、Compose 和 env，不回退数据库。第一次部署只有一个成功版本时没有 previous；保留 state 和恢复所需镜像，不运行自动 prune。

## 官方参考

- [Docker Compose 外部网络](https://docs.docker.com/compose/how-tos/networking/#use-an-existing-network)：API 与数据库共用既有网络。
- [Vercel 添加自定义域名](https://vercel.com/docs/domains/working-with-domains/add-a-domain)：按本项目 Domains 提示配置 DNS 与验证。
- [Nginx HTTP/2 模块](https://nginx.org/en/docs/http/ngx_http_v2_module.html)：HTTP/2 配置版本要求。
- [Certbot](https://certbot.eff.org/)：证书申请与续期。
- [MDN Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies)：SameSite、Secure 和 HttpOnly。
