# HTTP Inspector Brick

基于 mitmproxy 的独立 HTTP/HTTPS/WebSocket 调试工具。它与 SunnyNet 综合抓包 Brick 分开，不包含 TCP、UDP、TUN 或进程驱动。

## 使用

1. 打开 Brick，点击“启动代理”，默认监听 `127.0.0.1:8899`，并自动设置当前 macOS 网络服务的 HTTP/HTTPS 系统代理。
2. 若只想配置单个应用，可在应用自身的网络设置中填写主机 `127.0.0.1`、端口 `8899`。
3. 若需解密 HTTPS，先启动代理，再点击“安装 HTTPS 根证书”，然后在系统或目标应用中信任该证书。
4. 发送请求后，会话会出现在左侧列表。停止抓包或退出 Brickly 后，工具会恢复启动前的系统代理配置；如果配置已被其他代理软件修改，工具不会覆盖它。

Chrome 会继承 macOS 系统代理。设置代理后，用 Chrome 访问 `https://example.com` 验证；`localhost`、`127.0.0.1` 等地址通常会被浏览器绕过，不适合作为验证目标。macOS 的证书文件位于 `~/.mitmproxy/mitmproxy-ca-cert.cer`，安装后可在“钥匙串访问”中将它设置为“始终信任”。

### 快速验证

启动代理后，可以用下面的命令验证 HTTP 流量是否经过 Inspector：

```bash
curl -x http://127.0.0.1:8899 http://example.com
```

HTTPS 验证可临时使用 `-k`（仅用于本地验证）：

```bash
curl -k -x http://127.0.0.1:8899 https://example.com
```

仅用于你拥有或已获授权测试的流量。代理只监听本机回环地址。Certificate Pinning、应用私有证书库、mTLS 与 HTTP/3 无法通过本工具解密。

当前版本为避免覆盖用户或其他代理软件的设置，不自动修改系统代理。Windows 和 macOS 都通过 Brick 命令按保存的 SHA-256 指纹精确删除根证书，不按证书名称模糊匹配。

## 开发验证

```bash
python3 -m pytest runtime/python/tests -q
npm install
npm run typecheck
npm run build
```
