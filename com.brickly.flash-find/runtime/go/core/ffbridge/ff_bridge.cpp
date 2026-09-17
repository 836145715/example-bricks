// ff_bridge 实现：见 ff_bridge.h。
// JSON 手写拼接（记录字段都是标量），避免引入额外依赖。
#include "ff_bridge.h"

#include "../maceverything/Logger.h"
#include "../maceverything/SearchEngine.h"
#include "../maceverything/ServiceEngine.h"

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

namespace {

std::string jsonEscape(const std::string& in) {
    std::string out;
    out.reserve(in.size() + 8);
    for (unsigned char c : in) {
        switch (c) {
        case '"':  out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\b': out += "\\b";  break;
        case '\f': out += "\\f";  break;
        case '\n': out += "\\n";  break;
        case '\r': out += "\\r";  break;
        case '\t': out += "\\t";  break;
        default:
            if (c < 0x20) {
                char buf[8];
                snprintf(buf, sizeof(buf), "\\u%04x", c);
                out += buf;
            } else {
                out += static_cast<char>(c);
            }
        }
    }
    return out;
}

void appendRecord(std::string& out, const FileRecord& rec, bool first) {
    if (!first) out += ',';
    out += "{\"name\":\"";
    out += jsonEscape(rec.name);
    out += "\",\"path\":\"";
    out += jsonEscape(rec.path);
    out += "\",\"type\":";
    out += std::to_string(rec.type);
    out += ",\"size\":";
    out += std::to_string(rec.size);
    out += ",\"mtime\":";
    out += std::to_string(static_cast<long long>(rec.modTime));
    out += '}';
}

// C++ 异常不许越过 C 边界：查询类包一层，异常转 error JSON。
template <typename Fn> char* guarded(Fn&& fn) {
    try {
        return fn();
    } catch (const std::exception& ex) {
        return strdup((std::string("{\"error\":") + '"' + jsonEscape(ex.what()) + "\"}").c_str());
    } catch (...) {
        return strdup("{\"error\":\"unknown c++ exception\"}");
    }
}

} // namespace

struct ff_engine {
    explicit ff_engine(const ServiceConfig& cfg) : engine(cfg) {
        scanned.store(0);
        dirs.store(0);
        engine.onScanProgress = [this](uint64_t s, uint64_t d) {
            scanned.store(s, std::memory_order_relaxed);
            dirs.store(d, std::memory_order_relaxed);
        };
    }

    ServiceEngine engine;
    std::atomic<uint64_t> scanned{0};
    std::atomic<uint64_t> dirs{0};
};

extern "C" {

ff_engine* ff_new(const char* scan_root, const char* cache_dir, const char* log_dir) {
    if (!scan_root || !cache_dir || !log_dir || !*scan_root || !*cache_dir) return nullptr;
    try {
        static bool loggerReady = false;
        if (!loggerReady) {
            me::Logger::instance().init(log_dir, me::LogLevel::Info);
            loggerReady = true;
        }
        ServiceConfig cfg;
        cfg.scanRoot = scan_root;
        cfg.cachePath = cache_dir;
        cfg.logPath = log_dir;
        cfg.httpPort = 0; // 内嵌模式永远不起 HTTP
        return new ff_engine(cfg);
    } catch (...) {
        return nullptr;
    }
}

int ff_start(ff_engine* e) {
    if (!e) return -1;
    try {
        e->engine.startIncremental([](uint32_t total, bool fullScan) {
            LOG_INFO("ff_bridge", "ready: " << total << " records"
                                            << (fullScan ? " (full scan)" : " (cached)"));
        });
        return 0;
    } catch (...) {
        return -1;
    }
}

int ff_rebuild(ff_engine* e) {
    if (!e) return -1;
    try {
        e->engine.startFullScan([](uint32_t total, bool) {
            LOG_INFO("ff_bridge", "rebuild done: " << total << " records");
        });
        return 0;
    } catch (...) {
        return -1;
    }
}

char* ff_search(ff_engine* e, const char* query, int max_results) {
    if (!e || !query) return strdup("{\"error\":\"nil engine or query\"}");
    return guarded([&]() -> char* {
        uint32_t limit = max_results > 0 ? static_cast<uint32_t>(max_results) : 200;
        auto se = e->engine.safeEngine();
        if (!se) return strdup("{\"items\":[],\"count\":0,\"elapsedMs\":0}");

        QueryTimingInfo timing;
        const auto t0 = std::chrono::steady_clock::now();
        std::vector<uint32_t> hits = se->query(query, limit, /*useTrigram=*/true, timing);
        const double totalMs =
            timing.totalMs > 0
                ? timing.totalMs
                : std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();

        std::string out;
        out.reserve(hits.size() * 96 + 64);
        out += "{\"items\":[";
        bool first = true;
        for (uint32_t idx : hits) {
            FileRecord rec = se->getRecord(idx);
            if (rec.type == 0) continue; // tombstone
            appendRecord(out, rec, first);
            first = false;
        }
        out += "],\"count\":";
        out += std::to_string(hits.size());
        out += ",\"elapsedMs\":";
        out += std::to_string(totalMs);
        out += '}';
        return strdup(out.c_str());
    });
}

char* ff_recent(ff_engine* e, int count) {
    if (!e) return strdup("{\"items\":[],\"count\":0}");
    return guarded([&]() -> char* {
        uint32_t n = count > 0 ? static_cast<uint32_t>(count) : 50;
        auto se = e->engine.safeEngine();
        if (!se) return strdup("{\"items\":[],\"count\":0}");
        std::vector<uint32_t> hits = se->recentIndices(n);
        std::string out = "{\"items\":[";
        bool first = true;
        for (uint32_t idx : hits) {
            FileRecord rec = se->getRecord(idx);
            if (rec.type == 0) continue;
            appendRecord(out, rec, first);
            first = false;
        }
        out += "],\"count\":";
        out += std::to_string(hits.size());
        out += '}';
        return strdup(out.c_str());
    });
}

char* ff_status(ff_engine* e) {
    if (!e) return strdup("{\"error\":\"nil engine\"}");
    return guarded([&]() -> char* {
        std::string out = "{";
        auto flag = [&](bool v) { return v ? "true" : "false"; };
        out += std::string("\"scanning\":") + flag(e->engine.isScanning());
        out += std::string(",\"monitoring\":") + flag(e->engine.isMonitoring());
        out += std::string(",\"syncing\":") + flag(e->engine.isSyncing());
        out += ",\"records\":" + std::to_string(e->engine.recordCount());
        out += ",\"liveRecords\":" + std::to_string(e->engine.liveRecordCount());
        out += ",\"scanScanned\":" + std::to_string(e->scanned.load(std::memory_order_relaxed));
        out += ",\"scanDirs\":" + std::to_string(e->dirs.load(std::memory_order_relaxed));
        out += '}';
        return strdup(out.c_str());
    });
}

void ff_free_string(char* s) { free(s); }

} // extern "C"
