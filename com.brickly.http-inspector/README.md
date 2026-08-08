# HTTP Inspector Brick

基于 mitmproxy 的独立 HTTP/HTTPS/WebSocket 调试工具。它与 SunnyNet 综合抓包 Brick 分开，不包含 TCP、UDP、TUN 或进程驱动。

## 使用

1. 打开 Brick，启动监听，默认地址为 `127.0.0.1:8899`。
2. 在浏览器或待调试应用中手动设置 HTTP/HTTPS 代理。
3. 若需解密 HTTPS，先启动一次代理生成 CA，再点击证书按钮安装根证书。
4. 停止抓包后手动恢复客户端代理设置。

仅用于你拥有或已获授权测试的流量。代理只监听本机回环地址。Certificate Pinning、应用私有证书库、mTLS 与 HTTP/3 无法通过本工具解密。

当前版本为避免覆盖用户或其他代理软件的设置，不自动修改系统代理。Windows 和 macOS 都通过 Brick 命令按保存的 SHA-256 指纹精确删除根证书，不按证书名称模糊匹配。

## 开发验证

```bash
python3 -m pytest runtime/python/tests -q
npm install
npm run typecheck
npm run build
```
