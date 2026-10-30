# IP Lookup

一个可以部署到 Cloudflare Pages 的 IP / 域名查询站。打开页面能看到自己的网络信息；也可以查任意 IP 或域名的位置、运营商和线路特征。没有数据库，没有 API key，页面里也没有第三方统计脚本。

## 它怎么工作

### 你自己的地址

`/json` 和 `/api/whoami` 由 Pages Functions 处理，读的是同一份数据：

- 客户端 IP 来自 `CF-Connecting-IP`（没有这个头时才看 `True-Client-IP`、`X-Real-IP`、`X-Forwarded-For`）
- 国家、城市、经纬度、ASN、机房（colo）、TLS 和 HTTP 版本来自 `request.cf`
- `org` 使用 `asOrganization`。Cloudflare 没有单独的 ISP 字段，所以边缘响应里的 `isp` 是 `null`
- `country` 和 `country_code` 在边缘响应里都是 ISO 国家代码
- 响应带 `Access-Control-Allow-Origin: *` 和 `Cache-Control: no-store`

部署在 Cloudflare Pages 上时，`*.pages.dev` 和接入 Cloudflare 的自定义域名都能拿到 `request.cf`。本地 `wrangler pages dev` 里，访问者地址常常是 `127.0.0.1`，而 `request.cf` 有时会填上开发机所在机房的地理信息。页面把回环和私网地址当成不可用，改问公开接口，并在卡片上标出来源。直接请求 `/json` 仍返回边缘函数的原始字段。

### 根路径分流

`/` 同时看 User-Agent 和 Accept：

- curl、wget、HTTPie、PowerShell、python-requests 等客户端返回一行纯文本 IP，末尾有换行
- 这些客户端即使 `Accept` 里带了 `text/html`，仍然返回纯文本
- 浏览器（`Accept` 包含 `text/html`）返回这个页面
- 不带浏览器标识、且 `Accept` 不是 HTML 的请求，也返回纯文本

### 查任意 IP

浏览器按顺序请求下面四个公开接口，前一个失败、超时或限流才换下一个，并在结果里写明这次用的是哪一个：

1. `https://ipwho.is/{ip}`
2. `https://api.ip.sb/geoip/{ip}`
3. `https://get.geojs.io/v1/ip/geo/{ip}.json`
4. `https://ipapi.co/{ip}/json/`

查自己的地址时，如果边缘接口没有可用的公网地理信息，也按这个顺序回退，只是不在 URL 里填 IP。

### 查域名

浏览器并行向四家 DNS-over-HTTPS 查询 A、AAAA、MX、TXT、NS、CAA，以及 `_dmarc` 子域：

- `https://dns.google/resolve`
- `https://cloudflare-dns.com/dns-query`
- `https://dns.alidns.com/resolve`
- `https://doh.pub/dns-query`

TXT 会比较各家返回的记录，留下更完整的一份。解析出的地址再走上面的地理接口。没有 A/AAAA 但有 MX 或 TXT 时，仍然展示记录并做邮件简检，而不是当成解析失败。

邮件简检只看三件事：SPF 的 `all` 机制、DMARC 的 `p=`、有没有 MX。

### 风险分

0 到 100，完全在浏览器里算，不上传。云厂商、托管和代理 / VPN 关键词加分，住宅宽带和移动网络保持低分。名称缺失时，只用一小份常见 ASN 对照。

| 分数 | 标签 |
| --- | --- |
| 0–19 | 住宅 / 企业宽带 |
| 20–39 | 机房或骨干出口 |
| 40–69 | 云主机 / 托管 |
| 70–100 | 代理 / VPN 高概率 |

这是名称启发式，不是威胁情报，也不能说明某个地址在做坏事。

### 其他本地功能

- 子网 / CIDR 计算器：IPv4 与 IPv6。不写前缀时按 `/32` 或 `/128`。`/31` 按 RFC 3021。IPv6 的大地址总数写成 `2^n`
- 批量查询：最多 20 个，两路并发。域名先解析再查归属地，可导出 CSV
- 最近查询存在本机 `localStorage`，可以清除

## 接口

### `GET /`

```bash
curl -L https://你的域名
```

```text
203.0.113.10
```

### `GET /json` 与 `GET /api/whoami`

两者字段一致。加上 `?pretty` 会把 JSON 排成多行，字段不变。

```bash
curl -sL https://你的域名/json?pretty
```

```json
{
  "ip": "203.0.113.10",
  "type": "IPv4",
  "asn": 4134,
  "org": "Chinanet",
  "isp": null,
  "city": "Shanghai",
  "region": "Shanghai",
  "country": "CN",
  "country_code": "CN",
  "continent": "AS",
  "latitude": "31.22222",
  "longitude": "121.45806",
  "postal": "200000",
  "timezone": "Asia/Shanghai",
  "isEu": false,
  "colo": "SJC",
  "tlsVersion": "TLSv1.3",
  "tlsCipher": "AEAD-AES128-GCM-SHA256",
  "httpProtocol": "HTTP/3",
  "acceptLanguage": "zh-CN",
  "edge": true,
  "ts": 1700000000000
}
```

上面是字段示例，不是某一次真实查询。`latitude` / `longitude` 保持 `request.cf` 的字符串形式。`ts` 是毫秒时间戳。

Windows PowerShell 里的 `curl` 常常是 `Invoke-WebRequest` 的别名。请改用 `curl.exe -L https://你的域名`。

## 本地预览

需要 Node.js 20 或更新版本。

```bash
npm install
npx wrangler pages dev
```

终端会打印本地地址，默认一般是 `http://127.0.0.1:8788`。

```bash
curl -s http://127.0.0.1:8788/
curl -s http://127.0.0.1:8788/json
```

用浏览器打开同一个地址可以看到页面。本地往往没有边缘地理数据，右上角会改标公开接口的来源，这是预期行为。

运行单元测试：

```bash
npm test
```

## 部署到 Cloudflare Pages

不需要构建步骤，也不需要环境变量或 API key。静态文件在 `public/`，边缘函数在 `functions/`。

### 用 Git 连接

1. 把这个仓库推到 GitHub。
2. 打开 Cloudflare 控制台 → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**。
3. 选中仓库。生产分支用默认分支（通常是 `main`）。
4. 构建设置：
   - Framework preset：**None**
   - Build command：留空
   - Build output directory：`public`
5. 不要设置环境变量。根目录保持仓库根，这样 `functions/` 会被自动识别。
6. 保存并部署。

部署完成后，用浏览器打开 `*.pages.dev`，再用 `curl -L https://你的域名` 确认根路径返回一行 IP。`/json` 里应能看到 `edge: true`，以及 colo、国家和 TLS 字段。

### 用 Wrangler 直接部署

```bash
npx wrangler login
npx wrangler pages deploy public --project-name ip-lookup
```

在仓库根目录执行。Wrangler 会把 `public/` 当作静态资源，并带上同级的 `functions/`。

自定义域名在 Pages 项目的 **Custom domains** 里添加即可。流量已经在 Cloudflare 上，`request.cf` 不需要额外配置。

## 目录

```text
public/                 页面、样式和浏览器里的查询逻辑
functions/index.js      根路径：CLI 返回 IP，浏览器返回 HTML
functions/json.js       /json
functions/api/whoami.js /api/whoami
functions/_lib/         两边共用的字段和分流
wrangler.jsonc          Pages 项目配置
```

## 限制

- 城市级位置来自公开地理库，国家级比较稳，机房、移动网络和共享出口经常会偏几十到几百公里。
- 公开接口有各自的速率限制。批量查询最多 20 个，太密集会失败，等一会儿再试。
- `doh.pub` 有时不给浏览器跨域头。页面会并行询问，哪家没有返回就用另外三家。
- 风险分只看名称和少量 ASN，覆盖不了全部网络。
