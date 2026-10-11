# Aivory 宝塔线上部署与更新教程

本文档针对将你本地二开的 Aivory 部署到线上服务器，并通过宝塔面板管理域名、HTTPS、Docker 和反向代理。

推荐架构如下：

```text
用户浏览器
    ↓ HTTPS
宝塔 Nginx
    ↓ http://127.0.0.1:8787
Aivory app 容器
    ↓ Docker 内网
Postgres / Redis / Qdrant / Sandbox
```

Aivory 的 `app` 容器同时提供前端页面和 `/api` 接口，不需要单独部署前端 Nginx，也不需要配置前后端跨域。宝塔只负责：

1. 域名解析
2. 80/443 端口监听
3. SSL 证书
4. 将请求反向代理到 Aivory 的 Docker 端口

本文档默认使用 Docker Compose 部署正式环境，但源码来源是你自己的二开版本，不是上游 GitHub 仓库。

---

## 1. 部署前准备

### 1.1 服务器要求

建议配置：

1. Linux 服务器，Ubuntu、Debian、CentOS、Alibaba Cloud Linux 等均可
2. 至少 2 核 CPU、4 GB 内存
3. 至少 30 GB 可用磁盘空间
4. 已安装宝塔面板
5. 已安装 Docker 和 Docker Compose
6. 一个已经备案或可以正常解析的域名
7. 可用的模型 Provider API Key

如果要使用文档解析、向量检索、代码执行等能力，建议使用 4 核 CPU、8 GB 以上内存，并预留更多磁盘空间。

### 1.2 宝塔中安装 Docker

不同版本的宝塔菜单名称可能略有不同，通常可以按以下方式操作：

1. 登录宝塔面板
2. 打开“软件商店”
3. 搜索并安装 Docker 管理器或 Docker
4. 确认 Docker 服务已启动
5. 进入 Docker 管理器，确认可以查看容器和镜像

也可以通过 SSH 检查：

```bash
docker --version
docker compose version
```

如果 `docker compose version` 不可用，需要在宝塔 Docker 管理器中安装 Compose 插件，或按服务器系统安装 Docker Compose Plugin。

### 1.3 放行服务器端口

在云服务器安全组和宝塔“安全”页面中，至少放行：

| 端口 | 用途 |
|---|---|
| `80` | HTTP 和证书申请 |
| `443` | HTTPS |
| `8888` | 宝塔面板，建议限制为固定管理 IP |

不要对公网放行以下端口：

1. `5432`：Postgres
2. `6379`：Redis
3. `6333`：Qdrant
4. `8000`：Sandbox
5. `8787`：Aivory 应用端口，本文会绑定到 `127.0.0.1`，不直接暴露公网

如果云厂商安全组和宝塔防火墙都存在，需要两边都检查。

### 1.4 准备域名

在域名 DNS 管理处添加：

```text
类型：A
主机记录：www 或自定义前缀
记录值：服务器公网 IP
```

例如：

```text
ai.example.com  ->  服务器公网 IP
```

等待 DNS 生效后，在服务器上测试：

```bash
ping ai.example.com
```

`ping` 不通不一定代表 HTTP 不通，但域名解析结果应该是服务器公网 IP。

---

## 2. 把本地二开代码放到服务器

建议把项目放在：

```text
/www/wwwroot/aivory
```

线上服务器上只需要准备一个空目录，不要在这里直接拉上游仓库：

1. 在本地把你二开的完整项目准备好
2. 用宝塔文件管理器、SFTP、`scp`、`rsync` 或压缩包上传到 `/www/wwwroot/aivory`
3. 保持目录结构不变，至少要有 `deploy/`、`server/`、`src/`、`sandbox-service/`

最终应该能看到：

```text
/www/wwwroot/aivory/deploy/docker-compose.prod.yml
/www/wwwroot/aivory/deploy/.env.example
```

如果你后续持续二开更新，服务器上的这个目录就是“部署副本”，本地改完后再覆盖上传这里即可。

---

## 3. 配置线上环境变量

进入部署目录：

```bash
cd /www/wwwroot/aivory/deploy
cp .env.example .env
```

编辑 `.env`：

```bash
vi .env
```

也可以使用宝塔文件管理器打开：

```text
/www/wwwroot/aivory/deploy/.env
```

至少要修改以下配置：

```dotenv
POSTGRES_PASSWORD=替换成复杂的数据库密码
REDIS_PASSWORD=替换成复杂的Redis密码
JWT_SECRET=替换成长度足够长的随机字符串
QDRANT_API_KEY=替换成复杂的Qdrant密钥
```

### 3.1 推荐生成随机密钥

服务器安装了 OpenSSL 时执行：

```bash
openssl rand -hex 24
openssl rand -hex 24
openssl rand -hex 32
openssl rand -hex 24
```

依次将生成结果填入：

1. `POSTGRES_PASSWORD`
2. `REDIS_PASSWORD`
3. `JWT_SECRET`
4. `QDRANT_API_KEY`

不要把这些真实密钥提交到 Git，也不要把 `.env` 发到群里或上传到公开仓库。

### 3.2 推荐的线上 `.env` 示例

下面是线上部署时需要重点检查的配置：

```dotenv
IMAGE_OWNER=hjxwz123
IMAGE_TAG=local
SANDBOX_IMAGE_TAG=latest

POSTGRES_USER=aivory
POSTGRES_DB=aivory
POSTGRES_PASSWORD=请替换为强密码

REDIS_PASSWORD=请替换为强密码

QDRANT_URL=http://qdrant:6333
QDRANT_API_KEY=请替换为强密码

JWT_SECRET=请替换为长度至少32字符的随机字符串

DATA_DIR=./data
BACKUP_DIR=/app/data/backups
MAX_BACKUP_BYTES=21474836480

ENABLE_MOCK_PROVIDER=false
```

注意：

1. 仓库当前 `.env.example` 中使用的是 `IMAGE_OWNER`
2. 如果你只重建 app，不重建 sandbox，`SANDBOX_IMAGE_TAG` 建议固定为 `latest`
3. 如果你也改了 `sandbox-service/`，再把 `SANDBOX_IMAGE_TAG` 改成你自己构建的本地标签

### 3.3 模型 Provider Key 不写在 `.env`

OpenAI、Anthropic、Gemini 或其他模型服务商的 API Key 不需要写进 `.env`。

首次启动后，通过 Aivory 管理后台配置：

1. `/admin/channels`
2. 新增 Provider channel
3. 填写 API 地址和 API Key
4. 创建模型
5. 设置模型能力、上下文、价格和配额

这些信息会保存到数据库中。

---

## 4. 配置宝塔端口与 Docker 映射

宝塔通常会占用服务器的 `80` 和 `443` 端口，因此不建议让 Aivory Docker 直接绑定 `80:8787`。

### 4.1 修改 Compose 的 app 端口

打开：

```text
/www/wwwroot/aivory/deploy/docker-compose.prod.yml
```

找到：

```yaml
ports:
  - "80:8787"
```

改成：

```yaml
ports:
  - "127.0.0.1:8787:8787"
```

这样做的结果是：

1. Aivory 只监听服务器本机的 `127.0.0.1:8787`
2. 外部用户不能直接访问 `8787`
3. 宝塔 Nginx 可以通过 `127.0.0.1:8787` 转发请求
4. 公网访问统一走域名和 HTTPS

如果服务器的 `8787` 已被占用，可以改成其他本机端口，例如：

```yaml
ports:
  - "127.0.0.1:18787:8787"
```

后续宝塔反向代理目标就填写：

```text
http://127.0.0.1:18787
```

### 4.2 检查最终 Compose 配置

在 `deploy` 目录执行：

```bash
cd /www/wwwroot/aivory/deploy
docker compose --env-file .env -f docker-compose.prod.yml config
```

重点检查：

1. `app` 的端口是否为 `127.0.0.1:8787:8787`
2. `POSTGRES_PASSWORD`、`REDIS_PASSWORD`、`JWT_SECRET` 是否已读取
3. `IMAGE_TAG` 是否是期望版本
4. 没有错误的变量名或空的必填变量

### 4.3 在服务器上构建 app 镜像

把你本地二开的源码上传到服务器后，先在服务器上构建 app 镜像：

```bash
cd /www/wwwroot/aivory
docker build -f deploy/Dockerfile.app -t ghcr.io/hjxwz123/aivory-app:local .
```

如果你的 `IMAGE_TAG` 不是 `local`，这里的标签要和 `.env` 保持一致。  
compose 只会识别它实际要启动的那个镜像名。

注意：这里的 `docker build` 必须在**仓库根目录**执行，且服务器上的部署副本必须是完整项目根目录，至少要包含：

1. `public/`
2. `src/`
3. `server/`
4. `deploy/`
5. `index.html`
6. `package.json`
7. `package-lock.json`
8. `vite.config.ts`
9. `tsconfig.json`
10. `tailwind.config.ts`

如果你也改了 `sandbox-service/`，再分别构建 sidecar 和 runtime：

```bash
cd /www/wwwroot/aivory/sandbox-service
docker build -f Dockerfile.sidecar -t ghcr.io/hjxwz123/aivory-sandbox-sidecar:local .
docker build -f Dockerfile.runner -t ghcr.io/hjxwz123/aivory-sandbox:local .
```

如果 sandbox 没改，就不用构建这两张镜像，继续用现成的公共镜像即可。

---

## 5. 第一次启动 Docker 服务

在服务器执行：

```bash
cd /www/wwwroot/aivory/deploy

# 先拉取你仍然使用的公共基础镜像；如果你也把 sandbox 改成了本地镜像，
# 就不要把 sandbox 写进 pull 列表。
docker compose --env-file .env -f docker-compose.prod.yml pull postgres redis qdrant sandbox-image-keepalive
docker compose --env-file .env -f docker-compose.prod.yml up -d
```

查看容器：

```bash
docker compose --env-file .env -f docker-compose.prod.yml ps
```

正常情况下应该看到这些服务：

```text
postgres
redis
qdrant
sandbox
sandbox-image-keepalive
app
```

查看启动日志：

```bash
docker compose --env-file .env -f docker-compose.prod.yml logs -f app
```

看到服务持续运行且没有重复崩溃后，按 `Ctrl+C` 退出日志查看，不会停止容器。

也可以检查本机端口：

```bash
curl http://127.0.0.1:8787/api/health
```

如果返回健康状态或 HTTP 成功响应，说明 Aivory 应用已经在本机正常运行。

### 5.1 首次启动需要等待什么

首次启动可能需要等待：

1. Postgres 初始化
2. Redis 健康检查通过
3. Qdrant 启动
4. Sandbox 拉取运行时镜像
5. Aivory 自动创建数据库表

不需要手动执行 SQL。应用启动时会自动执行迁移。

### 5.2 Sandbox 镜像注意事项

代码执行功能使用单独的 Sandbox 运行时镜像。Compose 中的 `sandbox-image-keepalive` 服务会保持该镜像被引用，避免服务器执行 Docker 清理后下次运行 Python 时重新下载。

不要随意删除这个服务，也不要对生产服务器执行：

```bash
docker system prune -a
```

如果必须清理，优先使用：

```bash
docker image prune -f
```

清理前先确认不会删除 Aivory 当前版本的 app、sandbox 和 sandbox sidecar 镜像。

---

## 6. 在宝塔中添加网站和 HTTPS

### 6.1 添加站点

登录宝塔面板：

1. 进入“网站”
2. 点击“添加站点”
3. 填写域名，例如 `ai.example.com`
4. PHP 版本选择“纯静态”或不创建 PHP 项目
5. 不需要上传网站文件
6. 提交创建

这个站点的主要用途是让宝塔 Nginx 管理域名和反向代理。

### 6.2 配置反向代理

进入该站点：

1. 点击“设置”
2. 打开“反向代理”
3. 点击“添加反向代理”
4. 代理名称填写 `aivory`
5. 目标 URL 填写：

```text
http://127.0.0.1:8787
```

6. 保存配置

如果你使用了其他端口，就填对应端口，例如：

```text
http://127.0.0.1:18787
```

### 6.3 配置 HTTPS

在同一个宝塔站点中：

1. 打开“SSL”
2. 选择 Let’s Encrypt 或已有证书
3. 申请并部署证书
4. 开启“强制 HTTPS”
5. 保存并重载 Nginx

申请证书前必须确保：

1. 域名已经解析到当前服务器
2. 服务器安全组放行 `80` 和 `443`
3. 宝塔 Nginx 正常运行
4. 没有其他程序占用 80 端口

### 6.4 SSE 和长连接配置

Aivory 使用流式响应，宝塔 Nginx 需要关闭代理缓冲，并延长读取超时。

进入网站的“配置文件”，在 `server` 配置中确认或补充：

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

如果宝塔自动生成的反向代理配置已经包含 `proxy_pass`，不要重复添加多个同路径 `location /`。保留一份配置，并把以下参数合并进去：

```nginx
proxy_http_version 1.1;
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
```

保存后点击“保存”或“重载配置”。

### 6.5 线上访问验证

浏览器访问：

```text
https://你的域名
```

确认：

1. 页面能打开
2. 浏览器地址栏是 HTTPS
3. 注册或初始化页面能打开
4. 刷新页面不会 404
5. 登录后可以进入管理后台
6. 发起聊天时能持续收到流式内容

---

## 7. 首次初始化 Aivory

第一次进入线上域名时，系统默认没有用户。

按以下顺序操作：

1. 打开 `https://你的域名`
2. 进入初始化页面
3. 创建管理员昵称
4. 填写管理员邮箱
5. 设置高强度密码
6. 完成初始化

第一个创建的账号会成为管理员。

然后进入：

```text
https://你的域名/admin/channels
```

完成：

1. 添加真实 Provider
2. 填写模型 API Key
3. 创建至少一个聊天模型
4. 设置模型显示名称和能力
5. 用普通聊天页面发起一条测试消息

不要把 Provider API Key 写入前端代码、Git 文件或宝塔网站根目录。

---

## 8. 线上更新流程

线上更新前，建议先做备份，再更新镜像。不要直接删除 Docker 卷，也不要执行 `docker compose down -v`。

### 8.1 更新前检查

```bash
cd /www/wwwroot/aivory/deploy

docker compose --env-file .env -f docker-compose.prod.yml ps
docker compose --env-file .env -f docker-compose.prod.yml images
df -h
docker system df
```

确认：

1. 容器当前都是运行状态
2. 磁盘空间足够
3. `.env` 仍然存在
4. 数据目录仍然存在
5. 当前线上版本已记录

记录当前镜像：

```bash
docker compose --env-file .env -f docker-compose.prod.yml images
```

### 8.2 更新二开源码后的 app

如果你只更新了 **服务器上的二开源码**，最常见的方式是重新构建 app 镜像，然后重启：

```bash
cd /www/wwwroot/aivory
docker build -f deploy/Dockerfile.app -t ghcr.io/hjxwz123/aivory-app:local .
cd deploy
docker compose --env-file .env -f docker-compose.prod.yml up -d --no-build
```

查看状态：

```bash
docker compose --env-file .env -f docker-compose.prod.yml ps
docker compose --env-file .env -f docker-compose.prod.yml logs --tail=200 app
```

### 8.3 推荐使用固定版本号

生产环境建议不要长期使用 `latest`，而是使用明确的版本号：

```dotenv
IMAGE_TAG=3.0.0
```

注意：

1. 使用 `3.0.0`
2. 不要写 `v3.0.0`
3. 必须修改实际使用的 `/www/wwwroot/aivory/deploy/.env`
4. 不要只修改 `.env.example`

更新前先确认最终镜像：

```bash
docker compose --env-file .env -f docker-compose.prod.yml config --images
```

确认输出中的 Aivory 镜像都使用目标版本后执行：

```bash
cd /www/wwwroot/aivory
docker build -f deploy/Dockerfile.app -t ghcr.io/hjxwz123/aivory-app:3.0.0 .
cd deploy
docker compose --env-file .env -f docker-compose.prod.yml up -d --no-build
docker compose --env-file .env -f docker-compose.prod.yml images
```

### 8.4 从本地二开更新部署文件

如果你在本地改了源码，再同步到线上服务器，推荐流程是：

1. 在本地完成修改并通过测试
2. 把改动后的项目目录上传覆盖到服务器的 `/www/wwwroot/aivory`
3. 确认线上 `deploy/.env` 没被覆盖
4. 确认 `deploy/docker-compose.prod.yml` 里的 `127.0.0.1:8787:8787` 没被改回公网端口

如果你修改过 `deploy/docker-compose.prod.yml` 的宝塔端口映射，上传后必须重新检查这段配置：

```yaml
ports:
  - "127.0.0.1:8787:8787"
```

不要让更新操作把它变回：

```yaml
ports:
  - "80:8787"
```

否则可能与宝塔 Nginx 抢占 80 端口。

如果宝塔上传覆盖时提示冲突，不要直接覆盖 `.env`。`.env` 是线上密钥文件，应始终保留服务器上的真实配置。

### 8.5 更新后的验收

更新完成后依次检查：

1. `docker compose ps` 中容器状态正常
2. `curl http://127.0.0.1:8787/api/health` 有响应
3. 域名 HTTPS 可以打开
4. 登录正常
5. 历史对话仍然存在
6. 新建一条测试对话
7. 流式输出正常
8. 文件上传和下载正常
9. 知识库查询正常
10. Python 沙箱功能正常

如果本次更新只涉及普通前端或 API 功能，至少完成前 7 项。

---

## 9. 线上回滚流程

如果更新后出现严重问题，使用上一个已确认可用的版本回滚。

### 9.1 修改版本号

编辑：

```text
/www/wwwroot/aivory/deploy/.env
```

将：

```dotenv
IMAGE_TAG=当前版本
```

改回：

```dotenv
IMAGE_TAG=上一个稳定版本
```

### 9.2 回滚并启动旧版本

```bash
cd /www/wwwroot/aivory/deploy
docker compose --env-file .env -f docker-compose.prod.yml config --images
cd /www/wwwroot/aivory
docker build -f deploy/Dockerfile.app -t ghcr.io/hjxwz123/aivory-app:上一个稳定版本 .
cd deploy
docker compose --env-file .env -f docker-compose.prod.yml up -d --no-build
```

### 9.3 回滚后检查

```bash
docker compose --env-file .env -f docker-compose.prod.yml ps
docker compose --env-file .env -f docker-compose.prod.yml logs --tail=200 app
curl http://127.0.0.1:8787/api/health
```

如果数据库迁移已经发生，应用回滚不一定能自动回滚数据库结构。涉及数据库结构的版本升级，必须先阅读对应发布说明并准备数据库备份。

---

## 10. 备份与恢复

### 10.1 必须备份的内容

Aivory 的线上数据分布在：

1. Postgres Docker 命名卷 `pgdata`
2. Redis Docker 命名卷 `redisdata`
3. Qdrant Docker 命名卷 `qdrantdata`
4. Sandbox 本地归档卷 `sandbox-archives`
5. 宿主机数据目录 `DATA_DIR`，默认是：

```text
/www/wwwroot/aivory/deploy/data
```

上传文件、生成文件、头像和后台生成的备份归档都与宿主机数据目录有关。

不要只备份 `data` 目录，也不要只导出数据库。数据库记录、向量数据和磁盘文件需要一起保存。

### 10.2 使用管理后台生成迁移备份

管理员后台提供“备份与迁移”功能，可以生成包含数据库、文件和 Qdrant 向量的迁移 ZIP。

备份文件默认位于：

```text
/www/wwwroot/aivory/deploy/data/backups
```

建议：

1. 定期在后台生成全量备份
2. 将备份下载到服务器之外
3. 不要只把备份留在当前服务器
4. 更新前至少生成一次备份

### 10.3 备份 Docker 卷

查看实际卷名称：

```bash
docker volume ls | grep aivory
```

不同 Compose 目录或项目名可能产生不同的卷前缀，执行备份前先确认真实名称。

示例：

```bash
mkdir -p /www/backup/aivory

docker run --rm \
  -v aivory_pgdata:/source:ro \
  -v /www/backup/aivory:/backup \
  alpine tar czf /backup/pgdata-$(date +%F).tar.gz -C /source .
```

Redis、Qdrant 和 Sandbox 卷也应按同样方式备份。正式生产环境建议使用数据库逻辑备份加文件备份，并把备份复制到独立存储。

### 10.4 不要执行的命令

以下命令会删除数据卷，除非你明确要销毁整个环境，否则不要执行：

```bash
docker compose down -v
docker volume rm ...
```

正常更新只需要：

```bash
cd /www/wwwroot/aivory
docker build -f deploy/Dockerfile.app -t ghcr.io/hjxwz123/aivory-app:当前版本 .
cd deploy
docker compose up -d --no-build
```

---

## 11. 常见问题排查

### 11.1 宝塔提示 502 Bad Gateway

依次检查：

```bash
docker compose --env-file .env -f docker-compose.prod.yml ps
curl http://127.0.0.1:8787/api/health
docker compose --env-file .env -f docker-compose.prod.yml logs --tail=200 app
```

常见原因：

1. `app` 容器没有启动
2. 端口映射不是 `127.0.0.1:8787:8787`
3. 宝塔反向代理端口填写错误
4. `app` 仍在等待数据库健康检查
5. `.env` 中必填密码为空
6. 服务器内存不足导致容器被杀掉

### 11.2 宝塔站点打不开，但本机 curl 正常

说明 Aivory 大概率正常，问题在宝塔或域名层。检查：

1. 域名是否解析到当前服务器
2. 宝塔站点域名是否填写正确
3. 反向代理目标是否为 `http://127.0.0.1:8787`
4. SSL 证书是否已经部署
5. Nginx 配置是否成功保存
6. 云安全组是否放行 80/443

### 11.3 页面能打开，但聊天一直转圈

通常与流式响应代理有关。检查宝塔 Nginx 配置中是否有：

```nginx
proxy_http_version 1.1;
proxy_buffering off;
proxy_read_timeout 3600s;
```

同时查看：

```bash
docker compose --env-file .env -f docker-compose.prod.yml logs -f app
```

还要确认 `/admin/channels` 中的 Provider API Key、模型地址和模型配置正确。

### 11.4 容器反复重启

查看对应服务日志：

```bash
docker compose --env-file .env -f docker-compose.prod.yml logs --tail=300 app
docker compose --env-file .env -f docker-compose.prod.yml logs --tail=300 postgres
docker compose --env-file .env -f docker-compose.prod.yml logs --tail=300 redis
docker compose --env-file .env -f docker-compose.prod.yml logs --tail=300 sandbox
```

重点关注：

1. `JWT_SECRET` 是否设置且长度足够
2. Postgres 和 Redis 密码是否一致
3. 服务器磁盘是否满
4. 服务器内存是否不足
5. Docker 是否能访问 GHCR 镜像仓库
6. Sandbox 是否能拉取运行时镜像

### 11.5 更新后页面还是旧版本

检查：

```bash
docker compose --env-file .env -f docker-compose.prod.yml images
docker compose --env-file .env -f docker-compose.prod.yml ps
```

然后：

1. 确认修改的是实际 `.env`
2. 确认 `IMAGE_TAG` 正确
3. 确认镜像已经构建或拉取
4. 确认执行过 `up -d --no-build`
5. 浏览器执行强制刷新
6. 检查宝塔是否有页面缓存或 CDN 缓存

### 11.6 Python 沙箱执行失败

检查：

1. `sandbox` 和 `sandbox-image-keepalive` 是否运行
2. 宿主机 Docker 服务是否正常
3. `/var/run/docker.sock` 是否存在
4. 服务器磁盘和内存是否足够
5. Sandbox 运行时镜像是否已经拉取

```bash
docker compose --env-file .env -f docker-compose.prod.yml ps
docker images | grep aivory-sandbox
docker compose --env-file .env -f docker-compose.prod.yml logs --tail=200 sandbox
```

注意：Sandbox 容器需要访问宿主机 Docker Socket。不要把 Sandbox 的 HTTP 端口直接暴露到公网。

---

## 12. 线上日常更新标准流程

以后每次发布新版本，建议严格按下面执行：

### 更新前

```bash
cd /www/wwwroot/aivory/deploy
docker compose --env-file .env -f docker-compose.prod.yml ps
docker compose --env-file .env -f docker-compose.prod.yml images
df -h
```

1. 确认服务正常
2. 确认磁盘空间充足
3. 生成一次后台全量备份
4. 记录当前 `IMAGE_TAG`
5. 确认新版本的 app、sandbox、sandbox-sidecar 镜像都已发布

### 更新中

```bash
cd /www/wwwroot/aivory/deploy
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=目标版本/' .env
docker compose --env-file .env -f docker-compose.prod.yml config --images
cd /www/wwwroot/aivory
docker build -f deploy/Dockerfile.app -t ghcr.io/hjxwz123/aivory-app:目标版本 .
cd deploy
docker compose --env-file .env -f docker-compose.prod.yml up -d --no-build
```

如果不熟悉 `sed`，直接用宝塔文件管理器编辑 `.env` 更安全。

### 更新后

```bash
docker compose --env-file .env -f docker-compose.prod.yml ps
docker compose --env-file .env -f docker-compose.prod.yml logs --tail=200 app
curl http://127.0.0.1:8787/api/health
```

然后通过 HTTPS 域名完成登录、聊天、文件和后台功能验收。

---

## 13. 最简部署命令清单

### 首次部署

```bash
cd /www/wwwroot/aivory/deploy
cp .env.example .env
vi .env

# 先把 docker-compose.prod.yml 中的 80:8787 改为：
# 127.0.0.1:8787:8787

cd /www/wwwroot/aivory
docker build -f deploy/Dockerfile.app -t ghcr.io/hjxwz123/aivory-app:local .
cd deploy

docker compose --env-file .env -f docker-compose.prod.yml pull postgres redis qdrant sandbox-image-keepalive
docker compose --env-file .env -f docker-compose.prod.yml config --images
docker compose --env-file .env -f docker-compose.prod.yml up -d
docker compose --env-file .env -f docker-compose.prod.yml ps
```

然后在宝塔中：

```text
网站 -> 添加站点 -> 添加域名
网站设置 -> 反向代理 -> http://127.0.0.1:8787
网站设置 -> SSL -> 申请证书 -> 开启强制 HTTPS
```

### 后续更新

```bash
cd /www/wwwroot/aivory
# 先用本地改动覆盖上传到服务器，再在服务器上重建 app 镜像
docker build -f deploy/Dockerfile.app -t ghcr.io/hjxwz123/aivory-app:local .

cd deploy
# 确认 .env 和 127.0.0.1:8787:8787 没有被覆盖
docker compose --env-file .env -f docker-compose.prod.yml config --images
docker compose --env-file .env -f docker-compose.prod.yml up -d --no-build
docker compose --env-file .env -f docker-compose.prod.yml ps
```

---

## 14. 重要安全提醒

1. `.env` 中包含数据库密码、JWT 密钥等敏感信息，权限建议限制为 `600`
2. 不要把 `.env` 提交到 Git
3. 不要公开 Postgres、Redis、Qdrant 和 Sandbox 端口
4. 宝塔面板端口 `8888` 建议限制来源 IP
5. 生产环境必须使用 HTTPS
6. 不要执行 `docker compose down -v`
7. 不要随意删除 Docker 命名卷
8. 不要把 `docker.sock` 暴露给公网
9. 更新前先备份，更新后保留旧镜像以便回滚
10. Provider API Key 只在 Aivory 管理后台配置
