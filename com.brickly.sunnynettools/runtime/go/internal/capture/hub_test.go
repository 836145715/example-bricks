package capture

import "testing"

func TestAppendUpdateDeleteClear(t *testing.T) {
	ClearIndex()
	Append(10)
	Append(20)
	Append(10)
	if got := Order(); len(got) != 2 || got[0] != 10 || got[1] != 20 {
		t.Fatalf("order %v", got)
	}
	Remove(10)
	if got := Order(); len(got) != 1 || got[0] != 20 {
		t.Fatalf("after remove %v", got)
	}
	ClearIndex()
	if len(Order()) != 0 {
		t.Fatal("expected empty")
	}
}

func TestFilterView(t *testing.T) {
	ClearIndex()
	AppendBatch([]int{1, 2, 3, 4})
	SetFilter([]int{2, 4})
	if FilteredTotal() != 2 {
		t.Fatalf("total %d", FilteredTotal())
	}
	got := FilteredSlice(0, 10)
	if len(got) != 2 || got[0] != 2 || got[1] != 4 {
		t.Fatalf("slice %v", got)
	}
	if n := ClearFilter(); n != 4 {
		t.Fatalf("clear %d", n)
	}
}

func TestBroadcastToSubscriber(t *testing.T) {
	var got []map[string]any
	unreg := Register(func(ev any) error {
		m, _ := ev.(map[string]any)
		got = append(got, m)
		return nil
	})
	defer unreg()
	Broadcast(map[string]any{"type": "insert", "rows": []int{1}})
	if len(got) != 1 || got[0]["type"] != "insert" {
		t.Fatalf("got %#v", got)
	}
}
