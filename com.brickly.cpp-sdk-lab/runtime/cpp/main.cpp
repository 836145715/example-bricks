// create-brickly --preset window 的 C++ 对照：timer 跟随 runtime，pin 常驻。
// JSON 进出仍是字符串；本示例用 nlohmann/json 编解码。
#include "brickly.hpp"

#include <nlohmann/json.hpp>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <functional>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>

using json = nlohmann::json;

namespace {

json parse_object(std::string_view raw) {
	if (raw.empty()) {
		return json::object();
	}
	auto value = json::parse(raw, nullptr, false);
	if (value.is_discarded() || !value.is_object()) {
		return json::object();
	}
	return value;
}

int number_value(const json &data, const char *key, int fallback) {
	if (!data.contains(key) || data[key].is_null() || !data[key].is_number()) {
		return fallback;
	}
	return static_cast<int>(data[key].get<double>());
}

void apply_event(bool &paused, int &remaining, const json &event, int fallback) {
	const auto type = event.value("type", std::string());
	if (type == "pause") {
		paused = true;
	} else if (type == "resume") {
		paused = false;
	} else if (type == "reset") {
		remaining = fallback;
		paused = false;
	}
}

void send_tick(brickly::CommandContext *ctx, brickly::WindowHandle *win, int remaining) {
	const auto payload = json{{"type", "tick"}, {"remaining", remaining}}.dump();
	if (ctx != nullptr) {
		try {
			ctx->send(payload);
		} catch (const brickly::Error &) {
		}
	}
	if (win != nullptr) {
		try {
			win->send("tick", payload);
		} catch (const brickly::Error &) {
		}
	}
}

struct Countdown {
	std::mutex mu;
	std::condition_variable cv;
	int seconds = 60;
	int remaining = 60;
	bool paused = false;
	bool dirty = false;
	std::atomic<bool> stop{false};
	bool window_closed = false;
	brickly::WindowHandle win;
	brickly::Subscription closed;
	std::thread loop;
	brickly::CommandContext *ctx = nullptr;

	void request_stop() {
		stop.store(true);
		cv.notify_all();
	}

	void join() {
		request_stop();
		if (loop.joinable()) {
			loop.join();
		}
	}

	~Countdown() { join(); }
};

void expose_timer(Countdown &state, const std::function<void()> &tick) {
	state.win.expose("pause", [&state, tick](std::string_view) {
		{
			std::lock_guard<std::mutex> lock(state.mu);
			apply_event(state.paused, state.remaining, json{{"type", "pause"}}, state.seconds);
			state.dirty = true;
		}
		state.cv.notify_all();
		tick();
		return "null";
	});
	state.win.expose("resume", [&state, tick](std::string_view) {
		{
			std::lock_guard<std::mutex> lock(state.mu);
			apply_event(state.paused, state.remaining, json{{"type", "resume"}}, state.seconds);
			state.dirty = true;
		}
		state.cv.notify_all();
		tick();
		return "null";
	});
	state.win.expose("reset", [&state, tick](std::string_view) {
		{
			std::lock_guard<std::mutex> lock(state.mu);
			apply_event(state.paused, state.remaining, json{{"type", "reset"}}, state.seconds);
			state.dirty = true;
		}
		state.cv.notify_all();
		tick();
		return "null";
	});
}

void bind_countdown(Countdown &state) {
	auto tick = [&state] {
		brickly::CommandContext *ctx = nullptr;
		brickly::WindowHandle *win = nullptr;
		int remaining = 0;
		{
			std::lock_guard<std::mutex> lock(state.mu);
			remaining = state.remaining;
			ctx = state.ctx;
			win = &state.win;
		}
		send_tick(ctx, win, remaining);
	};

	state.closed = state.win.on("closed", [&state](std::string_view) {
		{
			std::lock_guard<std::mutex> lock(state.mu);
			state.window_closed = true;
		}
		state.request_stop();
	});

	expose_timer(state, tick);

	if (state.ctx != nullptr) {
		state.ctx->on_event([&state](std::string_view event) {
			{
				std::lock_guard<std::mutex> lock(state.mu);
				apply_event(state.paused, state.remaining, parse_object(event), state.seconds);
				state.dirty = true;
			}
			state.cv.notify_all();
		});
	}

	state.loop = std::thread([&state] {
		while (!state.stop.load()) {
			int remaining = 0;
			brickly::CommandContext *ctx = nullptr;
			brickly::WindowHandle *win = nullptr;
			bool should_tick = false;
			{
				std::unique_lock<std::mutex> lock(state.mu);
				const bool signaled = state.cv.wait_for(lock, std::chrono::seconds(1), [&] {
					return state.stop.load() || state.dirty;
				});
				if (state.stop.load()) {
					return;
				}
				if (state.dirty) {
					state.dirty = false;
					should_tick = true;
				} else if (!signaled && !state.paused && state.remaining > 0) {
					state.remaining--;
					should_tick = true;
				}
				if (!should_tick) {
					continue;
				}
				remaining = state.remaining;
				ctx = state.ctx;
				win = &state.win;
			}
			send_tick(ctx, win, remaining);
		}
	});

	tick();
}

void wait_until_done(Countdown &state, brickly::CommandContext &ctx) {
	std::unique_lock<std::mutex> lock(state.mu);
	while (!state.window_closed && !ctx.is_cancelled() && !state.stop.load()) {
		state.cv.wait_for(lock, std::chrono::milliseconds(200), [&] {
			return state.window_closed || ctx.is_cancelled() || state.stop.load();
		});
	}
}

std::mutex pin_swap_mu;
std::shared_ptr<Countdown> pin;

void stop_pin() {
	std::shared_ptr<Countdown> previous;
	{
		std::lock_guard<std::mutex> lock(pin_swap_mu);
		previous = std::move(pin);
	}
	if (previous) {
		previous->request_stop();
	}
}

json run_timer(brickly::CommandContext &ctx, std::string_view input) {
	const auto data = parse_object(input);
	Countdown state;
	state.ctx = &ctx;
	state.seconds = number_value(data, "seconds", 60);
	state.remaining = state.seconds;
	state.win = ctx.create_browser_window("ui/window.html", json{{"width", 360}, {"height", 280}, {"title", "倒计时"}}.dump());
	bind_countdown(state);
	wait_until_done(state, ctx);
	state.join();
	std::lock_guard<std::mutex> lock(state.mu);
	return json{{"remaining", state.remaining}};
}

json run_pin(brickly::CommandContext &ctx, std::string_view input) {
	const auto data = parse_object(input);
	stop_pin();

	auto state = std::make_shared<Countdown>();
	state->ctx = &ctx;
	state->seconds = number_value(data, "seconds", 60);
	state->remaining = state->seconds;
	state->win = ctx.create_browser_window(
		"ui/window.html", json{{"width", 360}, {"height", 280}, {"title", "常驻倒计时"}, {"lifetime", "standalone"}}.dump());
	bind_countdown(*state);
	{
		std::lock_guard<std::mutex> lock(pin_swap_mu);
		pin = state;
	}
	wait_until_done(*state, ctx);
	state->join();
	int remaining = 0;
	{
		std::lock_guard<std::mutex> lock(state->mu);
		remaining = state->remaining;
	}
	{
		std::lock_guard<std::mutex> lock(pin_swap_mu);
		if (pin == state) {
			pin.reset();
		}
	}
	return json{{"remaining", remaining}};
}

} // namespace

int main() {
	try {
		brickly::Runtime runtime;

		runtime.on_command("timer", [](brickly::CommandContext &ctx, std::string_view input) {
			ctx.reply(run_timer(ctx, input).dump());
		});

		runtime.on_command("pin", [](brickly::CommandContext &ctx, std::string_view input) {
			ctx.reply(run_pin(ctx, input).dump());
		});

		runtime.on_shutdown([] { stop_pin(); });
		runtime.start();
		return 0;
	} catch (const brickly::Error &err) {
		std::cerr << err.code << ": " << err.message << '\n';
		return 1;
	}
}
