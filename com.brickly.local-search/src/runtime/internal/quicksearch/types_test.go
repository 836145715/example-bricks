package quicksearch

import (
	"encoding/json"
	"strings"
	"testing"

	"brickly/local-search/internal/everything"
)

func TestParseSearchInputDefaultsAndClamp(t *testing.T) {
	params, err := ParseSearchInput(json.RawMessage(`{
		"providerId": " files ",
		"query": " report ",
		"sequence": 12,
		"limit": 200
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if params.ProviderID != "files" {
		t.Fatalf("ProviderID = %q", params.ProviderID)
	}
	if params.Query != "report" {
		t.Fatalf("Query = %q", params.Query)
	}
	if params.Sequence != 12 {
		t.Fatalf("Sequence = %d", params.Sequence)
	}
	if params.Limit != MaxLimit {
		t.Fatalf("Limit = %d", params.Limit)
	}
}

func TestBuildOutputMapsEverythingItems(t *testing.T) {
	output := BuildOutput([]everything.Item{
		{
			Name:      "Report.docx",
			Path:      `C:\Users\Ada\Documents`,
			FullPath:  `C:\Users\Ada\Documents\Report.docx`,
			Extension: "docx",
			IsFile:    true,
		},
		{
			Name:     "Projects",
			Path:     `D:\Work`,
			FullPath: `D:\Work\Projects`,
			IsFolder: true,
		},
	}, 20)

	if len(output.Results) != 2 {
		t.Fatalf("len(results) = %d", len(output.Results))
	}

	file := output.Results[0]
	if file.Title != "Report.docx" {
		t.Fatalf("file title = %q", file.Title)
	}
	if file.Subtitle != `C:\Users\Ada\Documents\Report.docx` {
		t.Fatalf("file subtitle = %q", file.Subtitle)
	}
	if file.Accessory != "DOCX" {
		t.Fatalf("file accessory = %q", file.Accessory)
	}
	if file.Category != "file" {
		t.Fatalf("file category = %q", file.Category)
	}
	if !strings.HasPrefix(file.ID, "file-") {
		t.Fatalf("file ID = %q", file.ID)
	}
	if file.DedupeKey != `file:c:\users\ada\documents\report.docx` {
		t.Fatalf("file dedupeKey = %q", file.DedupeKey)
	}
	if file.Activate == nil {
		t.Fatal("file result missing activate route")
	}
	if file.Activate.Command != "quick-search-open" {
		t.Fatalf("file activate command = %q", file.Activate.Command)
	}
	if file.Activate.Input.Path != `C:\Users\Ada\Documents\Report.docx` {
		t.Fatalf("file route path = %q", file.Activate.Input.Path)
	}

	folder := output.Results[1]
	if folder.Accessory != "文件夹" {
		t.Fatalf("folder accessory = %q", folder.Accessory)
	}
	if folder.Activate == nil || folder.Activate.Input.Kind != "folder" {
		t.Fatalf("folder route kind = %+v", folder.Activate)
	}
}

func TestBuildOutputSkipsItemsWithoutPathAndHonorsLimit(t *testing.T) {
	output := BuildOutput([]everything.Item{
		{Name: ""},
		{Name: "a.txt", FullPath: `C:\a.txt`, IsFile: true},
		{Name: "b.txt", FullPath: `C:\b.txt`, IsFile: true},
	}, 1)

	if len(output.Results) != 1 {
		t.Fatalf("len(results) = %d", len(output.Results))
	}
	if output.Results[0].Title != "a.txt" {
		t.Fatalf("first result = %q", output.Results[0].Title)
	}
}

func TestParseOpenInputRequiresLocalPath(t *testing.T) {
	params, err := ParseOpenInput(json.RawMessage(`{
		"path": "C:\\Users\\Ada\\Documents\\Report.docx",
		"title": "Report.docx",
		"kind": "file"
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if params.Path != `C:\Users\Ada\Documents\Report.docx` {
		t.Fatalf("Path = %q", params.Path)
	}
	if OpenedMessage(params) != "已打开 Report.docx" {
		t.Fatalf("OpenedMessage = %q", OpenedMessage(params))
	}

	if _, err := ParseOpenInput(json.RawMessage(`{"path":"relative.txt"}`)); err == nil {
		t.Fatal("expected relative path rejection")
	}
	if _, err := ParseOpenInput(json.RawMessage(`{}`)); err == nil {
		t.Fatal("expected missing path rejection")
	}
}
