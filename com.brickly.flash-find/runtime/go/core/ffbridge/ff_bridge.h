/*
 * ff_bridge — MacEverything Core 的进程内 C ABI。
 *
 * Go runtime (cgo) 通过这层驱动引擎，替代上游 CLI daemon 的角色：
 * 不起 HTTP / MCP / AI，回调只写原子计数器，Go 侧轮询。
 * 所有函数保证不向边界抛 C++ 异常；查询类返回 JSON 字符串（ff_free_string 释放）。
 *
 * 上游: github.com/joshua-wu/MacEverything @ 26f0332c (MIT)
 */
#ifndef FF_BRIDGE_H
#define FF_BRIDGE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct ff_engine ff_engine;

/* 创建引擎（含 Logger 初始化）。返回 NULL 表示参数缺失。 */
ff_engine* ff_new(const char* scan_root, const char* cache_dir, const char* log_dir);

/*
 * 增量启动：命中磁盘缓存则秒级加载，否则回退全量扫描。异步返回——
 * 0 = 已受理，进度用 ff_status / ff_scan_progress 轮询；-1 = 异常。
 */
int ff_start(ff_engine* e);

/* 全量重建索引。异步，立即返回。 */
int ff_rebuild(ff_engine* e);

/*
 * 搜索。query 透传引擎语法（普通子串；检测到 ext:/size:/path: 等
 * 过滤语法时自动走 AST）。max_results <= 0 时用默认 200。
 * 返回 JSON：{"items":[{name,path,type,size,mtime}...],"count":N,"elapsedMs":x,"error"?:str}
 */
char* ff_search(ff_engine* e, const char* query, int max_results);

/* 最近修改的文件。返回 JSON，结构与 ff_search 的 items 相同。 */
char* ff_recent(ff_engine* e, int count);

/* 引擎状态。JSON：{scanning,monitoring,syncing,records,liveRecords,scanScanned,scanDirs,ready} */
char* ff_status(ff_engine* e);

void ff_free_string(char* s);

#ifdef __cplusplus
}
#endif

#endif /* FF_BRIDGE_H */
