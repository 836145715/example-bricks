// Package cache 负责 last-scan 压缩快照在 Storage KV 里的存取。
// 只有这里的几个薄函数碰 SDK；序列化逻辑在 tree 包里测。
package cache

import (
	"context"
	"encoding/json"

	brickly "github.com/836145715/brickly-sdk-go"

	"com.brickly.disk-map/internal/model"
	"com.brickly.disk-map/internal/tree"
)

const lastScanKey = "last-scan"

// MinBytes 返回压缩门槛：max(1MiB, 根占用 × 0.5%)。
func MinBytes(rootAlloc int64) int64 {
	const floor = 1 << 20
	share := rootAlloc / 200
	if share > floor {
		return share
	}
	return floor
}

// Save 把压缩快照写进 KV。失败不致命，只记日志（由调用方处理）。
func Save(ctx context.Context, kv *brickly.KVStore, stored tree.StoredScan) error {
	value, err := encode(stored)
	if err != nil {
		return err
	}
	return kv.Set(ctx, lastScanKey, value)
}

// Load 读取压缩快照；没有缓存时返回 nil。
func Load(ctx context.Context, kv *brickly.KVStore) (*tree.StoredScan, error) {
	raw, err := kv.Get(ctx, lastScanKey)
	if err != nil {
		return nil, err
	}
	if raw == nil {
		return nil, nil
	}
	return decode(raw)
}

// encode 把快照收成纯 map/slice，保证 KV 里存的是 JSON 值（asJSONValue 同口径）。
func encode(stored tree.StoredScan) (any, error) {
	data, err := json.Marshal(stored)
	if err != nil {
		return nil, err
	}
	var decoded any
	if err := json.Unmarshal(data, &decoded); err != nil {
		return nil, err
	}
	return decoded, nil
}

func decode(raw any) (*tree.StoredScan, error) {
	data, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	var stored tree.StoredScan
	if err := json.Unmarshal(data, &stored); err != nil {
		return nil, err
	}
	if stored.Root == "" {
		return nil, nil
	}
	return &stored, nil
}

// BuildSnapshot 生成扫描结束后的压缩快照：深度 ≤4、≥门槛的目录 + 全部 recipe 命中 + 扩展名聚合。
func BuildSnapshot(root string, t *tree.Tree, hits []string, extStats []model.ExtStat) tree.StoredScan {
	minBytes := int64(1 << 20)
	if summary, ok := t.Summary(root); ok {
		minBytes = MinBytes(summary.AllocatedBytes)
	}
	keep := make(map[string]bool, len(hits))
	for _, h := range hits {
		keep[h] = true
	}
	return t.Compress(4, minBytes, keep, extStats)
}
