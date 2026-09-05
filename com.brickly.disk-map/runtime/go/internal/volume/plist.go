package volume

import (
	"bytes"
	"encoding/xml"
	"strconv"
	"strings"
)

// plistValue 是 plist 里标量值的类型 + 文本。
type plistValue struct {
	Kind    string // integer | real | string | date | true | false
	Content string
}

// LookupPurgeable 在 diskutil info -plist 输出里尽力找 Purgeable 字节数。
// 键名按 macOS 版本可能是 Purgeable / ContainerPurgeableSpace 等；找不到返回 false。
func LookupPurgeable(plist []byte) (int64, bool) {
	values, err := parseFlatPlist(plist)
	if err != nil {
		return 0, false
	}
	for _, key := range []string{"Purgeable", "PurgeableSpace", "ContainerPurgeableSpace"} {
		if v, ok := values[key]; ok {
			if n, ok := plistInt(v); ok {
				return n, true
			}
		}
	}
	return 0, false
}

// parseFlatPlist 解析 XML plist 顶层 <dict> 的标量键值。
// diskutil 的输出有嵌套容器（APFSContainer 等），遇到容器值整体跳过。
func parseFlatPlist(data []byte) (map[string]plistValue, error) {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	decoder.Strict = false
	out := map[string]plistValue{}
	var key string
	haveKey := false
	topDict := false
	containerDepth := 0 // >0 表示正在跳过某个嵌套容器值

	for {
		tok, err := decoder.Token()
		if err != nil {
			return out, nil // 容错：解析到哪算哪
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "dict", "array":
				switch {
				case containerDepth > 0:
					containerDepth++
				case !topDict && t.Name.Local == "dict":
					topDict = true
				case haveKey:
					containerDepth = 1 // 该 key 的值是容器：跳过
					haveKey = false
					key = ""
				}
			case "key":
				if topDict && containerDepth == 0 {
					var k string
					if err := decoder.DecodeElement(&k, &t); err == nil {
						key = strings.TrimSpace(k)
						haveKey = true
					}
				}
			case "integer", "real", "string", "date":
				if containerDepth > 0 {
					continue
				}
				if topDict && haveKey {
					var v string
					if err := decoder.DecodeElement(&v, &t); err == nil {
						out[key] = plistValue{Kind: t.Name.Local, Content: strings.TrimSpace(v)}
					}
					haveKey = false
					key = ""
				}
			case "true", "false":
				if containerDepth > 0 {
					continue
				}
				if topDict && haveKey {
					out[key] = plistValue{Kind: t.Name.Local}
					haveKey = false
					key = ""
				}
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "dict", "array":
				if containerDepth > 0 {
					containerDepth--
				} else if topDict && t.Name.Local == "dict" {
					topDict = false
				}
			}
		}
	}
}

func plistInt(v plistValue) (int64, bool) {
	switch v.Kind {
	case "integer":
		n, err := strconv.ParseInt(v.Content, 10, 64)
		return n, err == nil
	case "real":
		f, err := strconv.ParseFloat(v.Content, 64)
		return int64(f), err == nil
	case "true":
		return 1, true
	}
	return 0, false
}

// ParseSnapshots 解析 tmutil listlocalsnapshots 输出。
// 输出形如：
//
//	Snapshots for /:
//	com.apple.TimeMachine.2026-08-01-120000.local
func ParseSnapshots(out string) []string {
	snapshots := []string{}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.Contains(line, ":") {
			continue
		}
		if strings.HasPrefix(line, "com.apple.TimeMachine.") || strings.Contains(line, ".local") {
			snapshots = append(snapshots, line)
		}
	}
	return snapshots
}
