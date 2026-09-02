#pragma once

#include <string>
#include <string_view>

inline std::string json_escape(std::string_view input) {
	std::string out;
	out.reserve(input.size() + 8);
	for (unsigned char ch : input) {
		switch (ch) {
		case '"':
			out += "\\\"";
			break;
		case '\\':
			out += "\\\\";
			break;
		case '\b':
			out += "\\b";
			break;
		case '\f':
			out += "\\f";
			break;
		case '\n':
			out += "\\n";
			break;
		case '\r':
			out += "\\r";
			break;
		case '\t':
			out += "\\t";
			break;
		default:
			if (ch < 0x20) {
				const char *hex = "0123456789abcdef";
				out += "\\u00";
				out += hex[ch >> 4];
				out += hex[ch & 0x0f];
			} else {
				out += static_cast<char>(ch);
			}
			break;
		}
	}
	return out;
}

inline std::string json_string(std::string_view input) {
	return "\"" + json_escape(input) + "\"";
}

inline std::string json_get_string(std::string_view json, std::string_view key, std::string_view fallback = {}) {
	const std::string needle = "\"" + std::string(key) + "\"";
	auto pos = json.find(needle);
	if (pos == std::string_view::npos) {
		return std::string(fallback);
	}
	pos = json.find(':', pos + needle.size());
	if (pos == std::string_view::npos) {
		return std::string(fallback);
	}
	pos = json.find_first_not_of(" \t\r\n", pos + 1);
	if (pos == std::string_view::npos || json[pos] != '"') {
		return std::string(fallback);
	}
	std::string out;
	for (size_t i = pos + 1; i < json.size(); ++i) {
		const char ch = json[i];
		if (ch == '\\' && i + 1 < json.size()) {
			out += json[++i];
			continue;
		}
		if (ch == '"') {
			return out.empty() ? std::string(fallback) : out;
		}
		out += ch;
	}
	return std::string(fallback);
}
