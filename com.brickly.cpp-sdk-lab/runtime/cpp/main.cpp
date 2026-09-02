// com.brickly.cpp-sdk-lab
// native Brick：C++ 头链接 brickly-sdk-go 的 c-shared。命令与 Node/Go 实验室对齐：
// hello / runtime-info / make-note（invoke），chat（interact）。
#include "brickly.hpp"
#include "json_lite.hpp"

#include <functional>
#include <iostream>
#include <string>
#include <string_view>

namespace {

std::string field_or_error(const char *key, const std::function<std::string()> &read) {
	try {
		return std::string("\"") + key + "\":" + json_string(read());
	} catch (const brickly::Error &err) {
		return std::string("\"") + key + "\":null,\"" + key + "Error\":" + json_string(err.code + ": " + err.message);
	}
}

} // namespace

int main() {
	try {
		brickly::Runtime runtime;

		runtime.on_command("hello", [](brickly::CommandContext &ctx, std::string_view input) {
			const auto name = json_get_string(input, "name", "Brickly");
			ctx.info("cpp hello", std::string(R"({"name":)") + json_string(name) + "}");
			ctx.reply(std::string(R"({"message":"Hello, )") + json_escape(name) + R"(","runtime":"cpp"})");
		});

		runtime.on_command("runtime-info", [&runtime](brickly::CommandContext &ctx, std::string_view) {
			std::string body = "{";
			body += "\"sdk\":" + json_string(std::string(brickly::Runtime::version()));
			body += ",\"protocol\":" + json_string(std::string(brickly::Runtime::protocol_version()));
			body += ",\"language\":\"cpp\"";
			try {
				body += std::string(",\"isWindows\":") + (runtime.system_is_windows() ? "true" : "false");
			} catch (const brickly::Error &err) {
				body += ",\"isWindows\":null,\"isWindowsError\":" + json_string(err.code + ": " + err.message);
			}
			body += "," + field_or_error("appName", [&] { return runtime.system_get_app_name(); });
			body += "," + field_or_error("tempPath", [&] { return runtime.system_get_path("temp"); });
			const auto config = ctx.config_json();
			body += ",\"config\":";
			body += config.empty() ? "{}" : config;
			body += "}";
			ctx.reply(body);
		});

		runtime.on_command("make-note", [](brickly::CommandContext &ctx, std::string_view input) {
			auto text = json_get_string(input, "text", "hello from C++");
			auto handle = ctx.create_resource(text, "text/plain; charset=utf-8", "cpp-note.txt");
			const auto ref = handle.ref_json();
			const auto roundtrip = handle.text();
			ctx.reply(std::string(R"({"runtime":"cpp","ref":)") + (ref.empty() ? "null" : ref) + R"(,"text":)" +
				json_string(roundtrip) + "}");
		});

		runtime.on_command("chat", [](brickly::CommandContext &ctx, std::string_view input) {
			const auto prompt = json_get_string(input, "prompt", "");
			if (!prompt.empty()) {
				ctx.send(std::string(R"({"type":"hello","text":)") + json_string("C++ 已就绪: " + prompt) + "}");
			}
			ctx.on_event([&](std::string_view event) {
				const auto text = json_get_string(event, "text", std::string(event));
				ctx.send(std::string(R"({"type":"reply","text":)") + json_string("收到 " + text) + "}");
			});
			ctx.wait_closed();
			ctx.reply(R"({"ok":true,"runtime":"cpp"})");
		});

		runtime.start();
		return 0;
	} catch (const brickly::Error &err) {
		std::cerr << err.code << ": " << err.message << '\n';
		return 1;
	}
}
