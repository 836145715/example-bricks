# HTTP Inspector Brick

基于 mitmproxy 的独立 HTTP/HTTPS/WebSocket 调试工具。它与 SunnyNet 综合抓包 Brick 分开，不包含 TCP、UDP、TUN 或进程驱动。

## 使用

1. 打开 Brick，点击“启动代理”，默认监听 `127.0.0.1:8899`。
2. 在浏览器或待调试应用中手动设置 HTTP/HTTPS 代理：主机 `127.0.0.1`，端口 `8899`。
3. macOS 可在“系统设置 → 网络 → 当前网络 → 详细信息 → 代理”中分别填写 HTTP 代理和 HTTPS 代理；也可以只配置需要抓包的应用。
4. 若需解密 HTTPS，先启动代理，再点击“安装 HTTPS 根证书”，然后在系统或目标应用中信任该证书。
5. 发送请求后，会话会出现在左侧列表。停止抓包后手动恢复客户端代理设置。

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
