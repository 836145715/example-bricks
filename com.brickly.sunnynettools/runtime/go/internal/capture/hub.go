package capture

import "sync"

type RowFlags struct {
	BreakMode        uint32
	GuaranteeDisplay bool
}

type session struct {
	send func(any) error
}

var (
	mu         sync.RWMutex
	order      []int
	pos        = make(map[int]int)
	filterSet  map[int]bool
	flags      sync.Map
	hubMu      sync.RWMutex
	streams    = make(map[int]*session)
	seq        int
)

func Append(theology int) {
	mu.Lock()
	defer mu.Unlock()
	if _, ok := pos[theology]; ok {
		return
	}
	order = append(order, theology)
	pos[theology] = len(order) - 1
}

func AppendBatch(theologies []int) {
	if len(theologies) == 0 {
		return
	}
	mu.Lock()
	defer mu.Unlock()
	for _, t := range theologies {
		if _, ok := pos[t]; ok {
			continue
		}
		order = append(order, t)
		pos[t] = len(order) - 1
	}
}

func Remove(theology int) {
	mu.Lock()
	p, ok := pos[theology]
	if !ok {
		mu.Unlock()
		return
	}
	order = append(order[:p], order[p+1:]...)
	delete(pos, theology)
	for i := p; i < len(order); i++ {
		pos[order[i]] = i
	}
	mu.Unlock()
	ClearFlags(theology)
}

func ClearIndex() {
	mu.Lock()
	order = order[:0]
	pos = make(map[int]int)
	mu.Unlock()
	ClearAllFlags()
}

func Order() []int {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]int, len(order))
	copy(out, order)
	return out
}

func SetFlags(theology int, breakMode uint32, guarantee bool) {
	flags.Store(theology, RowFlags{BreakMode: breakMode, GuaranteeDisplay: guarantee})
}

func MergeBreakMode(theology int, breakMode uint32) {
	prev := GetFlags(theology)
	prev.BreakMode = breakMode
	flags.Store(theology, prev)
}

func GetFlags(theology int) RowFlags {
	if v, ok := flags.Load(theology); ok {
		if f, ok := v.(RowFlags); ok {
			return f
		}
	}
	return RowFlags{}
}

func ClearFlags(theology int) {
	flags.Delete(theology)
}

func ClearAllFlags() {
	flags.Range(func(key, _ any) bool {
		flags.Delete(key)
		return true
	})
}

func Broadcast(event map[string]any) {
	hubMu.RLock()
	sends := make([]func(any) error, 0, len(streams))
	for _, s := range streams {
		sends = append(sends, s.send)
	}
	hubMu.RUnlock()
	for _, send := range sends {
		_ = send(event)
	}
}

func BroadcastIDs(eventType string, theologies []int) {
	if len(theologies) == 0 {
		return
	}
	Broadcast(map[string]any{"type": eventType, "ids": theologies})
}

func HasSubscribers() bool {
	hubMu.RLock()
	defer hubMu.RUnlock()
	return len(streams) > 0
}

func Register(send func(any) error) func() {
	hubMu.Lock()
	seq++
	id := seq
	streams[id] = &session{send: send}
	hubMu.Unlock()
	return func() {
		hubMu.Lock()
		delete(streams, id)
		hubMu.Unlock()
	}
}

func SetFilter(ids []int) {
	mu.Lock()
	defer mu.Unlock()
	filterSet = make(map[int]bool, len(ids))
	for _, id := range ids {
		filterSet[id] = true
	}
}

func ClearFilter() int {
	mu.Lock()
	defer mu.Unlock()
	filterSet = nil
	return len(order)
}

func FilteredTotal() int {
	mu.RLock()
	defer mu.RUnlock()
	if filterSet == nil {
		return len(order)
	}
	n := 0
	for _, t := range order {
		if filterSet[t] {
			n++
		}
	}
	return n
}

func FilteredSlice(offset, limit int) []int {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]int, 0, limit)
	n := 0
	for _, t := range order {
		if filterSet != nil && !filterSet[t] {
			continue
		}
		if n >= offset && len(out) < limit {
			out = append(out, t)
		}
		n++
		if len(out) >= limit {
			break
		}
	}
	return out
}

func FilterLen() int {
	mu.RLock()
	defer mu.RUnlock()
	if filterSet == nil {
		return -1
	}
	return len(filterSet)
}
