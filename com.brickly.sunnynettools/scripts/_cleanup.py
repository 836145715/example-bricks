from pathlib import Path

root = Path(r"d:/main-brick/example-bricks/com.brickly.sunnynettools")
paths = [
    root / "runtime/go/Service/control.go",
    root / "runtime/go/Service/control_test.go",
    root / "frontend/src/wails-shim/index.js",
    root / "frontend/src/wails-shim/commands-map.json",
    root / "frontend/src/wails-shim/bindings-map.json",
    root / "frontend/bindings/changeme/Service/appmain.js",
    root / "frontend/bindings/changeme/Service/bridge.js",
    root / "frontend/bindings/github.com/wailsapp/wails/v3/internal/eventcreate.js",
    root / "frontend/bindings/github.com/qtgolang/SunnyNet/src/http/models.js",
    root / "frontend/bindings/changeme/Service/models.js",
    root / "frontend/bindings/changeme/Service/mcp/models.js",
    root / "frontend/bindings/changeme/Service/Tools/models.js",
    root / "frontend/bindings/changeme/Service/Session/models.js",
    root / "frontend/bindings/changeme/Service/Config/models.js",
    root / "scripts/_patch_mcp.py",
    root / "scripts/_rewrite_imports.py",
]
for p in paths:
    if p.exists():
        p.unlink()
        print("deleted", p.relative_to(root))
    else:
        print("missing", p.relative_to(root))
