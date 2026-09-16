package preview

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestParseInputDefaultsAndClamp(t *testing.T) {
	input, err := json.Marshal(map[string]any{
		"path":       "C:/demo.txt",
		"maxBytes":   HardMaxBytes * 10,
		"maxEntries": HardMaxEntries * 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	params, err := ParseInput(input)
	if err != nil {
		t.Fatal(err)
	}
	if params.MaxBytes != HardMaxBytes {
		t.Fatalf("MaxBytes = %d, want %d", params.MaxBytes, HardMaxBytes)
	}
	if params.MaxEntries != HardMaxEntries {
		t.Fatalf("MaxEntries = %d, want %d", params.MaxEntries, HardMaxEntries)
	}
}

func TestParseInputRejectsEmptyPath(t *testing.T) {
	if _, err := ParseInput([]byte(`{"path":"  "}`)); err == nil {
		t.Fatal("expected empty path error")
	}
}

func TestBuildTextPreview(t *testing.T) {
	path := writeFile(t, "notes.txt", "第一行\n第二行")
	result, err := Build(Input{Path: path, MaxBytes: DefaultMaxBytes, MaxEntries: DefaultMaxEntries})
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindText || !result.Supported {
		t.Fatalf("kind/supported = %s/%v", result.Kind, result.Supported)
	}
	if result.Text == nil || result.Text.LineCount != 2 {
		t.Fatalf("text preview = %#v", result.Text)
	}
	if !strings.Contains(result.FileURL, "notes.txt") {
		t.Fatalf("fileUrl = %q", result.FileURL)
	}
}

func TestBuildTextPreviewTruncates(t *testing.T) {
	path := writeFile(t, "long.log", strings.Repeat("a", int(TextPreviewBytes)+128))
	result, err := Build(Input{Path: path, MaxBytes: TextPreviewBytes, MaxEntries: DefaultMaxEntries})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Truncated {
		t.Fatal("expected truncated result")
	}
	if got := len(result.Text.Content); got != int(TextPreviewBytes) {
		t.Fatalf("content length = %d, want %d", got, TextPreviewBytes)
	}
}

func TestParseInputClampsTextPreviewTo20KiB(t *testing.T) {
	params, err := ParseInput([]byte(`{"path":"C:/demo.txt","maxBytes":999999}`))
	if err != nil {
		t.Fatal(err)
	}
	if params.MaxBytes != TextPreviewBytes {
		t.Fatalf("MaxBytes = %d, want %d", params.MaxBytes, TextPreviewBytes)
	}
}

func TestBuildRejectsBinaryAsText(t *testing.T) {
	path := writeBytes(t, "binary.txt", []byte{0x00, 0x01, 0x02, 0x03})
	result, err := Build(Input{Path: path, MaxBytes: DefaultMaxBytes, MaxEntries: DefaultMaxEntries})
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindUnsupported || result.Supported {
		t.Fatalf("kind/supported = %s/%v", result.Kind, result.Supported)
	}
}

func TestBuildZipPreview(t *testing.T) {
	path := writeZip(t, "bundle.zip", map[string]string{
		"docs/readme.txt": "hello",
		"src/main.go":     "package main",
		"assets/icon.svg": "<svg />",
	})
	result, err := Build(Input{Path: path, MaxBytes: DefaultMaxBytes, MaxEntries: 2})
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindArchive || result.Archive == nil {
		t.Fatalf("archive result = %#v", result)
	}
	if result.Archive.Total != 3 || !result.Archive.Truncated || len(result.Archive.Entries) != 2 {
		t.Fatalf("archive preview = %#v", result.Archive)
	}
}

func TestBuildZipPreviewDecodesGBKNames(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("GBK zip name decoding uses Windows code page API")
	}
	path := writeZipWithRawName(t, "gbk.zip", []byte{0xCE, 0xC4, 0xBC, 0xFE, '/', 0xB2, 0xE2, 0xCA, 0xD4, '.', 't', 'x', 't'}, []byte("hello"))
	result, err := Build(Input{Path: path, MaxBytes: DefaultMaxBytes, MaxEntries: DefaultMaxEntries})
	if err != nil {
		t.Fatal(err)
	}
	if result.Archive == nil || len(result.Archive.Entries) != 1 {
		t.Fatalf("archive result = %#v", result.Archive)
	}
	if got := result.Archive.Entries[0].Name; got != "文件/测试.txt" {
		t.Fatalf("entry name = %q", got)
	}
}

func TestBuildDocxPreview(t *testing.T) {
	path := writeZip(t, "demo.docx", map[string]string{
		"word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t>World</w:t></w:r></w:p><w:p><w:r><w:t>下一段</w:t></w:r></w:p></w:body></w:document>`,
	})
	result, err := Build(Input{Path: path, MaxBytes: DefaultMaxBytes, MaxEntries: DefaultMaxEntries})
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindDocument || result.Document == nil {
		t.Fatalf("document result = %#v", result)
	}
	if !strings.Contains(result.Document.Content, "Hello World") || !strings.Contains(result.Document.Content, "下一段") {
		t.Fatalf("content = %q", result.Document.Content)
	}
	if result.Document.Renderer != "docx-preview" || result.Document.Package == "" {
		t.Fatalf("document package metadata = %#v", result.Document)
	}
	if _, err := base64.StdEncoding.DecodeString(result.Document.Package); err != nil {
		t.Fatalf("package is not base64: %v", err)
	}
}

func TestBuildDocmPreview(t *testing.T) {
	path := writeZip(t, "macro.docm", map[string]string{
		"word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Macro text</w:t></w:r></w:p></w:body></w:document>`,
	})
	result, err := Build(Input{Path: path, MaxBytes: DefaultMaxBytes, MaxEntries: DefaultMaxEntries})
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindDocument || result.Document == nil || !strings.Contains(result.Document.Content, "Macro text") {
		t.Fatalf("document result = %#v", result)
	}
}

func TestBuildRTFPreview(t *testing.T) {
	path := writeFile(t, "demo.rtf", `{\rtf1\ansi Hello\par Word \u20320?}`)
	result, err := Build(Input{Path: path, MaxBytes: DefaultMaxBytes, MaxEntries: DefaultMaxEntries})
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindDocument || result.Document == nil {
		t.Fatalf("document result = %#v", result)
	}
	if !strings.Contains(result.Document.Content, "Hello") || !strings.Contains(result.Document.Content, "Word 你") {
		t.Fatalf("content = %q", result.Document.Content)
	}
}

func TestBuildOldDocExplainsUnsupported(t *testing.T) {
	path := writeBytes(t, "legacy.doc", []byte{0xD0, 0xCF, 0x11, 0xE0})
	result, err := Build(Input{Path: path, MaxBytes: DefaultMaxBytes, MaxEntries: DefaultMaxEntries})
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindUnsupported || result.Supported || !strings.Contains(result.Reason, ".doc") {
		t.Fatalf("doc result = %#v", result)
	}
}

func TestBuildXlsxPreview(t *testing.T) {
	path := writeZip(t, "table.xlsx", map[string]string{
		"xl/sharedStrings.xml": `<?xml version="1.0"?><sst xmlns="s"><si><t>Name</t></si><si><t>Count</t></si><si><t>Apple</t></si></sst>`,
		"xl/workbook.xml":      `<?xml version="1.0"?><workbook xmlns="s"><sheets><sheet name="库存"/></sheets></workbook>`,
		"xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet xmlns="s"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>12</v></c></row>
</sheetData></worksheet>`,
	})
	result, err := Build(Input{Path: path, MaxBytes: DefaultMaxBytes, MaxEntries: DefaultMaxEntries})
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindSpreadsheet || result.Spreadsheet == nil || len(result.Spreadsheet.Sheets) != 1 {
		t.Fatalf("spreadsheet result = %#v", result)
	}
	rows := result.Spreadsheet.Sheets[0].Rows
	if result.Spreadsheet.Sheets[0].Name != "库存" || rows[0][0] != "Name" || rows[1][0] != "Apple" || rows[1][1] != "12" {
		t.Fatalf("sheet = %#v", result.Spreadsheet.Sheets[0])
	}
}

func TestBuildDirectoryPreview(t *testing.T) {
	result, err := Build(Input{Path: t.TempDir(), MaxBytes: DefaultMaxBytes, MaxEntries: DefaultMaxEntries})
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindDirectory || result.Supported {
		t.Fatalf("directory result = %#v", result)
	}
}

func TestFileURLUsesStandardWindowsShape(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows path shape")
	}
	if got := fileURL(`C:\Users\demo\a.txt`); got != "file:///C:/Users/demo/a.txt" {
		t.Fatalf("fileURL = %q", got)
	}
}

func writeFile(t *testing.T, name string, content string) string {
	t.Helper()
	return writeBytes(t, name, []byte(content))
}

func writeBytes(t *testing.T, name string, content []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func writeZip(t *testing.T, name string, files map[string]string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	target, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	writer := zip.NewWriter(target)
	for itemName, content := range files {
		entry, err := writer.Create(itemName)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func writeZipWithRawName(t *testing.T, name string, rawName []byte, content []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	var buffer bytes.Buffer
	crc := crc32.ChecksumIEEE(content)
	const methodStore uint16 = 0
	localHeaderOffset := uint32(buffer.Len())
	writeUint32(t, &buffer, 0x04034b50)
	writeUint16(t, &buffer, 20)
	writeUint16(t, &buffer, 0)
	writeUint16(t, &buffer, methodStore)
	writeUint16(t, &buffer, 0)
	writeUint16(t, &buffer, 0)
	writeUint32(t, &buffer, crc)
	writeUint32(t, &buffer, uint32(len(content)))
	writeUint32(t, &buffer, uint32(len(content)))
	writeUint16(t, &buffer, uint16(len(rawName)))
	writeUint16(t, &buffer, 0)
	buffer.Write(rawName)
	buffer.Write(content)

	centralDirectoryOffset := uint32(buffer.Len())
	writeUint32(t, &buffer, 0x02014b50)
	writeUint16(t, &buffer, 20)
	writeUint16(t, &buffer, 20)
	writeUint16(t, &buffer, 0)
	writeUint16(t, &buffer, methodStore)
	writeUint16(t, &buffer, 0)
	writeUint16(t, &buffer, 0)
	writeUint32(t, &buffer, crc)
	writeUint32(t, &buffer, uint32(len(content)))
	writeUint32(t, &buffer, uint32(len(content)))
	writeUint16(t, &buffer, uint16(len(rawName)))
	writeUint16(t, &buffer, 0)
	writeUint16(t, &buffer, 0)
	writeUint16(t, &buffer, 0)
	writeUint16(t, &buffer, 0)
	writeUint32(t, &buffer, 0)
	writeUint32(t, &buffer, localHeaderOffset)
	buffer.Write(rawName)
	centralDirectorySize := uint32(buffer.Len()) - centralDirectoryOffset

	writeUint32(t, &buffer, 0x06054b50)
	writeUint16(t, &buffer, 0)
	writeUint16(t, &buffer, 0)
	writeUint16(t, &buffer, 1)
	writeUint16(t, &buffer, 1)
	writeUint32(t, &buffer, centralDirectorySize)
	writeUint32(t, &buffer, centralDirectoryOffset)
	writeUint16(t, &buffer, 0)

	if err := os.WriteFile(path, buffer.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func writeUint16(t *testing.T, buffer *bytes.Buffer, value uint16) {
	t.Helper()
	if err := binary.Write(buffer, binary.LittleEndian, value); err != nil {
		t.Fatal(err)
	}
}

func writeUint32(t *testing.T, buffer *bytes.Buffer, value uint32) {
	t.Helper()
	if err := binary.Write(buffer, binary.LittleEndian, value); err != nil {
		t.Fatal(err)
	}
}
