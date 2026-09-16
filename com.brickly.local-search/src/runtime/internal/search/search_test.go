package search

import (
	"encoding/json"
	"testing"
)

func TestBuildQuery(t *testing.T) {
	tests := []struct {
		name     string
		query    string
		category Category
		want     string
	}{
		{name: "all empty", category: CategoryAll, want: "*"},
		{name: "all query", query: "report", category: CategoryAll, want: "report"},
		{name: "folder", query: "project", category: CategoryFolder, want: "folder:project"},
		{name: "pdf", query: "invoice", category: CategoryPDF, want: "file: ext:pdf invoice"},
		{name: "image empty", category: CategoryImage, want: "file: ext:jpg;jpeg;png;gif;webp;bmp;ico;svg;tif;tiff"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := BuildQuery(tt.query, tt.category); got != tt.want {
				t.Fatalf("BuildQuery() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestParseInputDefaultsAndClamp(t *testing.T) {
	params, err := ParseInput(json.RawMessage(`{"query":"  test  ","limit":999,"offset":-10}`))
	if err != nil {
		t.Fatal(err)
	}
	if params.Query != "test" {
		t.Fatalf("query = %q", params.Query)
	}
	if params.Category != CategoryAll {
		t.Fatalf("category = %q", params.Category)
	}
	if params.Offset != 0 {
		t.Fatalf("offset = %d", params.Offset)
	}
	if params.Limit != MaxLimit {
		t.Fatalf("limit = %d", params.Limit)
	}
	if params.Sort != "name_asc" {
		t.Fatalf("sort = %q", params.Sort)
	}
}

func TestParseInputRejectsInvalidCategory(t *testing.T) {
	if _, err := ParseInput(json.RawMessage(`{"category":"unknown"}`)); err == nil {
		t.Fatal("expected invalid category error")
	}
}

func TestParseInputRejectsInvalidSort(t *testing.T) {
	if _, err := ParseInput(json.RawMessage(`{"sort":"random"}`)); err == nil {
		t.Fatal("expected invalid sort error")
	}
}
