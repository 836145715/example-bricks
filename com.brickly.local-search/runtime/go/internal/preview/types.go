package preview

const (
	TextPreviewBytes  int64 = 20 * 1024
	DefaultMaxBytes   int64 = TextPreviewBytes
	HardMaxBytes      int64 = TextPreviewBytes
	MaxDocumentBytes  int64 = 8 * 1024 * 1024
	DefaultMaxEntries       = 80
	HardMaxEntries          = 200
	DefaultMaxRows          = 40
	DefaultMaxColumns       = 24
	MaxSheets               = 3
)

type Kind string

const (
	KindText        Kind = "text"
	KindImage       Kind = "image"
	KindAudio       Kind = "audio"
	KindVideo       Kind = "video"
	KindPDF         Kind = "pdf"
	KindArchive     Kind = "archive"
	KindSpreadsheet Kind = "spreadsheet"
	KindDocument    Kind = "document"
	KindDirectory   Kind = "directory"
	KindUnsupported Kind = "unsupported"
)

type Input struct {
	Path       string `json:"path"`
	MaxBytes   int64  `json:"maxBytes"`
	MaxEntries int    `json:"maxEntries"`
}

type Result struct {
	Path        string              `json:"path"`
	Name        string              `json:"name"`
	Extension   string              `json:"extension"`
	Kind        Kind                `json:"kind"`
	Mime        string              `json:"mime"`
	FileURL     string              `json:"fileUrl,omitempty"`
	Size        int64               `json:"size"`
	ModifiedAt  int64               `json:"modifiedAt"`
	IsDirectory bool                `json:"isDirectory"`
	Supported   bool                `json:"supported"`
	Status      string              `json:"status"`
	Truncated   bool                `json:"truncated"`
	Message     string              `json:"message,omitempty"`
	Reason      string              `json:"reason,omitempty"`
	Text        *TextPreview        `json:"text,omitempty"`
	Image       *ImagePreview       `json:"image,omitempty"`
	Archive     *ArchivePreview     `json:"archive,omitempty"`
	Document    *DocumentPreview    `json:"document,omitempty"`
	Spreadsheet *SpreadsheetPreview `json:"spreadsheet,omitempty"`
	Meta        map[string]any      `json:"meta,omitempty"`
}

type TextPreview struct {
	Content   string `json:"content"`
	Encoding  string `json:"encoding"`
	BytesRead int64  `json:"bytesRead"`
	LineCount int    `json:"lineCount"`
}

type ImagePreview struct {
	Width  int `json:"width,omitempty"`
	Height int `json:"height,omitempty"`
}

type ArchivePreview struct {
	Entries   []ArchiveEntry `json:"entries"`
	Total     int            `json:"total"`
	Truncated bool           `json:"truncated"`
}

type ArchiveEntry struct {
	Name           string `json:"name"`
	Size           uint64 `json:"size"`
	CompressedSize uint64 `json:"compressedSize"`
	IsDirectory    bool   `json:"isDirectory"`
	ModifiedAt     int64  `json:"modifiedAt"`
}

type DocumentPreview struct {
	Content   string `json:"content"`
	Encoding  string `json:"encoding"`
	BytesRead int64  `json:"bytesRead"`
	LineCount int    `json:"lineCount"`
	Package   string `json:"package,omitempty"`
	Renderer  string `json:"renderer,omitempty"`
}

type SpreadsheetPreview struct {
	Sheets    []SheetPreview `json:"sheets"`
	Truncated bool           `json:"truncated"`
}

type SheetPreview struct {
	Name      string     `json:"name"`
	Rows      [][]string `json:"rows"`
	Truncated bool       `json:"truncated"`
}

type ValidationError struct {
	Message string
}

func (err *ValidationError) Error() string {
	return err.Message
}
