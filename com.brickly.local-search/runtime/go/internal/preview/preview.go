package preview

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"
)

var (
	textExtensions = set(
		".txt", ".md", ".markdown", ".log", ".csv", ".tsv", ".json", ".jsonl", ".xml",
		".yaml", ".yml", ".toml", ".ini", ".env", ".conf", ".config", ".properties",
		".go", ".js", ".jsx", ".ts", ".tsx", ".css", ".scss", ".sass", ".less",
		".html", ".htm", ".vue", ".svelte", ".py", ".rb", ".php", ".java", ".kt",
		".kts", ".c", ".h", ".cpp", ".hpp", ".cs", ".rs", ".swift", ".sh", ".bash",
		".zsh", ".ps1", ".bat", ".cmd", ".sql", ".dockerfile", ".gitignore",
	)
	imageExtensions       = set(".jpg", ".jpeg", ".png", ".gif", ".bmp", ".ico", ".svg", ".webp", ".tif", ".tiff")
	imageConfigExtensions = set(".jpg", ".jpeg", ".png", ".gif")
	audioExtensions       = set(".mp3", ".wav", ".flac", ".aac", ".m4a", ".ogg", ".wma", ".ape")
	videoExtensions       = set(".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpeg", ".mpg")
	archiveExtensions     = set(".zip", ".jar", ".epub")
	unsupportedArchives   = set(".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".iso")
	oldOfficeExtensions   = set(".doc", ".xls", ".ppt", ".pps")
	rtfSkipDestinations   = set("fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer", "footerf", "footerl", "footerr", "generator")
)

func ParseInput(input []byte) (Input, error) {
	params := Input{
		MaxBytes:   DefaultMaxBytes,
		MaxEntries: DefaultMaxEntries,
	}
	if len(input) > 0 {
		if err := json.Unmarshal(input, &params); err != nil {
			return Input{}, &ValidationError{Message: fmt.Sprintf("解析预览参数失败: %v", err)}
		}
	}
	params.Path = strings.TrimSpace(params.Path)
	if params.Path == "" {
		return Input{}, &ValidationError{Message: "path 不能为空"}
	}
	if params.MaxBytes <= 0 {
		params.MaxBytes = DefaultMaxBytes
	}
	if params.MaxBytes > HardMaxBytes {
		params.MaxBytes = HardMaxBytes
	}
	if params.MaxEntries <= 0 {
		params.MaxEntries = DefaultMaxEntries
	}
	if params.MaxEntries > HardMaxEntries {
		params.MaxEntries = HardMaxEntries
	}
	return params, nil
}

func Build(input Input) (Result, error) {
	abs, err := filepath.Abs(input.Path)
	if err != nil {
		return Result{}, fmt.Errorf("解析文件路径失败: %w", err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return Result{}, fmt.Errorf("读取文件状态失败: %w", err)
	}

	result := baseResult(abs, info)
	if info.IsDir() {
		result.Kind = KindDirectory
		result.Supported = false
		result.Status = "directory"
		result.Message = "文件夹暂不支持内嵌预览，可直接打开或定位目录。"
		return result, nil
	}

	ext := "." + result.Extension
	switch {
	case textExtensions[ext]:
		return textPreview(result, input.MaxBytes)
	case ext == ".docx" || ext == ".docm":
		return docxPreview(result, input.MaxBytes)
	case ext == ".rtf":
		return rtfPreview(result, input.MaxBytes)
	case ext == ".xlsx" || ext == ".xlsm":
		return xlsxPreview(result)
	case ext == ".csv":
		return textPreview(result, input.MaxBytes)
	case ext == ".pdf":
		result.Kind = KindPDF
		result.Mime = "application/pdf"
		result.Supported = true
		result.Status = "ok"
		return result, nil
	case imageExtensions[ext]:
		return imagePreview(result, ext)
	case audioExtensions[ext]:
		result.Kind = KindAudio
		result.Mime = mimeByExtension(ext)
		result.Supported = true
		result.Status = "ok"
		return result, nil
	case videoExtensions[ext]:
		result.Kind = KindVideo
		result.Mime = mimeByExtension(ext)
		result.Supported = true
		result.Status = "ok"
		return result, nil
	case archiveExtensions[ext]:
		return zipPreview(result, input.MaxEntries)
	case ext == ".pptx":
		return zipPreview(asUnsupported(result, "PPTX 暂不提取正文，已提供内部文件列表。"), input.MaxEntries)
	case ext == ".doc":
		result.Kind = KindUnsupported
		result.Status = "unsupported"
		result.Reason = "旧版 Word .doc 是二进制格式，当前 Go 原生预览暂不支持安全解析。"
		result.Message = "可以使用打开文件查看；后续如需支持 .doc，需要接 Windows 预览处理器或 Office 转换链。"
		return result, nil
	case oldOfficeExtensions[ext]:
		result.Kind = KindUnsupported
		result.Status = "unsupported"
		result.Reason = "旧版 Office 二进制格式暂不支持内嵌预览。"
		result.Message = "可以使用打开文件或定位目录继续查看。"
		return result, nil
	case unsupportedArchives[ext]:
		result.Kind = KindUnsupported
		result.Status = "unsupported"
		result.Reason = "该压缩格式暂不支持安全列目录。"
		result.Message = "当前版本只读取 ZIP/JAR/EPUB/DOCX/XLSX，不会解压未知归档。"
		return result, nil
	default:
		result.Kind = KindUnsupported
		result.Status = "unsupported"
		result.Reason = "暂不支持该文件类型的内嵌预览。"
		result.Message = "可以使用打开文件或定位目录继续查看。"
		return result, nil
	}
}

func baseResult(path string, info os.FileInfo) Result {
	ext := strings.ToLower(filepath.Ext(info.Name()))
	return Result{
		Path:        path,
		Name:        info.Name(),
		Extension:   strings.TrimPrefix(ext, "."),
		Kind:        KindUnsupported,
		Mime:        mimeByExtension(ext),
		FileURL:     fileURL(path),
		Size:        info.Size(),
		ModifiedAt:  info.ModTime().UnixMilli(),
		IsDirectory: info.IsDir(),
		Supported:   false,
		Status:      "unsupported",
	}
}

func textPreview(result Result, maxBytes int64) (Result, error) {
	data, truncated, err := readPrefix(result.Path, maxBytes)
	if err != nil {
		return Result{}, err
	}
	content, encoding, binary := decodeText(data)
	if binary {
		result.Kind = KindUnsupported
		result.Status = "unsupported"
		result.Reason = "文件包含二进制内容，已停止文本预览。"
		result.Message = "为避免乱码和卡顿，二进制文件不会按文本读取。"
		return result, nil
	}
	if result.Extension == "json" || result.Extension == "jsonl" {
		content = formatJSONIfPossible(content, result.Extension == "jsonl")
	}
	result.Kind = KindText
	result.Mime = textMime(result.Extension, encoding)
	result.Supported = true
	result.Status = "ok"
	result.Truncated = truncated
	result.Text = &TextPreview{
		Content:   content,
		Encoding:  encoding,
		BytesRead: int64(len(data)),
		LineCount: countLines(content),
	}
	if result.Extension == "csv" {
		if rows, err := parseCSVPreview(content); err == nil && len(rows) > 0 {
			result.Meta = map[string]any{"csvRows": rows}
		}
	}
	return result, nil
}

func imagePreview(result Result, ext string) (Result, error) {
	result.Kind = KindImage
	result.Mime = mimeByExtension(ext)
	result.Supported = true
	result.Status = "ok"
	if imageConfigExtensions[ext] {
		file, err := os.Open(result.Path)
		if err == nil {
			defer file.Close()
			if cfg, _, err := image.DecodeConfig(io.LimitReader(file, 512*1024)); err == nil {
				result.Image = &ImagePreview{Width: cfg.Width, Height: cfg.Height}
			}
		}
	}
	return result, nil
}

func zipPreview(result Result, maxEntries int) (Result, error) {
	reader, err := zip.OpenReader(result.Path)
	if err != nil {
		return Result{}, fmt.Errorf("读取 ZIP 目录失败: %w", err)
	}
	defer reader.Close()

	entries := make([]ArchiveEntry, 0, minInt(len(reader.File), maxEntries))
	for index, file := range reader.File {
		if index >= maxEntries {
			break
		}
		entries = append(entries, ArchiveEntry{
			Name:           archiveEntryName(file),
			Size:           file.UncompressedSize64,
			CompressedSize: file.CompressedSize64,
			IsDirectory:    file.FileInfo().IsDir(),
			ModifiedAt:     file.Modified.UnixMilli(),
		})
	}
	result.Kind = KindArchive
	result.Mime = archiveMime(result.Extension)
	result.Supported = true
	result.Status = "ok"
	result.Truncated = len(reader.File) > maxEntries
	result.Archive = &ArchivePreview{
		Entries:   entries,
		Total:     len(reader.File),
		Truncated: len(reader.File) > maxEntries,
	}
	return result, nil
}

func archiveEntryName(file *zip.File) string {
	name := file.Name
	if name == "" || isASCIIString(name) {
		return name
	}
	if !file.NonUTF8 && utf8.ValidString(name) {
		return name
	}
	if decoded, ok := decodeLegacyArchiveName([]byte(name)); ok && strings.TrimSpace(decoded) != "" {
		return decoded
	}
	return strings.ToValidUTF8(name, "�")
}

func docxPreview(result Result, maxBytes int64) (Result, error) {
	packageData, packageTooLarge, err := readDocumentPackage(result.Path, result.Size)
	if err != nil {
		return Result{}, err
	}

	reader, err := zip.OpenReader(result.Path)
	if err != nil {
		return Result{}, fmt.Errorf("读取 DOCX 文件失败: %w", err)
	}
	defer reader.Close()

	file := findZipFile(reader.File, "word/document.xml")
	if file == nil {
		result.Kind = KindUnsupported
		result.Status = "unsupported"
		result.Reason = "DOCX 中没有找到正文 XML。"
		return result, nil
	}
	content, bytesRead, truncated, err := readDocxText(file, maxBytes)
	if err != nil {
		return Result{}, err
	}
	if packageTooLarge {
		truncated = true
	}
	result.Kind = KindDocument
	result.Mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	result.Supported = true
	result.Status = "ok"
	result.Truncated = truncated
	result.Document = &DocumentPreview{
		Content:   content,
		Encoding:  "utf-8",
		BytesRead: bytesRead,
		LineCount: countLines(content),
		Package:   packageData,
		Renderer:  "docx-preview",
	}
	return result, nil
}

func readDocumentPackage(path string, size int64) (string, bool, error) {
	if size <= 0 || size > MaxDocumentBytes {
		return "", size > MaxDocumentBytes, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", false, fmt.Errorf("读取 DOCX 包失败: %w", err)
	}
	return base64.StdEncoding.EncodeToString(data), false, nil
}

func rtfPreview(result Result, maxBytes int64) (Result, error) {
	data, truncated, err := readPrefix(result.Path, maxBytes)
	if err != nil {
		return Result{}, err
	}
	content := stripRTF(data)
	result.Kind = KindDocument
	result.Mime = "application/rtf"
	result.Supported = true
	result.Status = "ok"
	result.Truncated = truncated
	result.Document = &DocumentPreview{
		Content:   content,
		Encoding:  "rtf",
		BytesRead: int64(len(data)),
		LineCount: countLines(content),
	}
	return result, nil
}

func xlsxPreview(result Result) (Result, error) {
	reader, err := zip.OpenReader(result.Path)
	if err != nil {
		return Result{}, fmt.Errorf("读取 XLSX 文件失败: %w", err)
	}
	defer reader.Close()

	sharedStrings, _ := readSharedStrings(reader.File)
	sheets := worksheetFiles(reader.File)
	if len(sheets) == 0 {
		result.Kind = KindUnsupported
		result.Status = "unsupported"
		result.Reason = "XLSX 中没有找到工作表。"
		return result, nil
	}
	names := workbookSheetNames(reader.File)
	previews := make([]SheetPreview, 0, minInt(len(sheets), MaxSheets))
	for index, sheetFile := range sheets {
		if index >= MaxSheets {
			break
		}
		rows, truncated, err := readWorksheet(sheetFile, sharedStrings)
		if err != nil {
			continue
		}
		name := fmt.Sprintf("Sheet%d", index+1)
		if index < len(names) && strings.TrimSpace(names[index]) != "" {
			name = names[index]
		}
		previews = append(previews, SheetPreview{Name: name, Rows: rows, Truncated: truncated})
	}
	result.Kind = KindSpreadsheet
	result.Mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	result.Supported = len(previews) > 0
	result.Status = "ok"
	result.Spreadsheet = &SpreadsheetPreview{
		Sheets:    previews,
		Truncated: len(sheets) > MaxSheets || anySheetTruncated(previews),
	}
	if len(previews) == 0 {
		result.Status = "unsupported"
		result.Reason = "未能解析 XLSX 工作表内容。"
	}
	return result, nil
}

type rtfState struct {
	skip bool
	uc   int
}

func stripRTF(data []byte) string {
	states := []rtfState{{uc: 1}}
	var builder strings.Builder
	skipFallback := 0
	for index := 0; index < len(data); index++ {
		ch := data[index]
		current := &states[len(states)-1]
		switch ch {
		case '{':
			states = append(states, *current)
		case '}':
			if len(states) > 1 {
				states = states[:len(states)-1]
			}
		case '\\':
			index = readRTFControl(data, index+1, &states[len(states)-1], &builder, &skipFallback)
		case '\r', '\n':
			continue
		default:
			if skipFallback > 0 {
				skipFallback--
				continue
			}
			if !current.skip {
				builder.WriteByte(ch)
			}
		}
	}
	return compactPreviewText(builder.String())
}

func readRTFControl(data []byte, index int, state *rtfState, builder *strings.Builder, skipFallback *int) int {
	if index >= len(data) {
		return index
	}
	if data[index] == '\'' && index+2 < len(data) {
		if !state.skip && *skipFallback == 0 {
			if value, ok := parseHexByte(data[index+1], data[index+2]); ok {
				builder.WriteByte(value)
			}
		}
		return index + 2
	}
	if !isASCIIAlpha(data[index]) {
		if !state.skip && *skipFallback == 0 {
			switch data[index] {
			case '\\', '{', '}':
				builder.WriteByte(data[index])
			case '~':
				builder.WriteByte(' ')
			case '_', '-':
				builder.WriteByte('-')
			}
		}
		return index
	}

	start := index
	for index < len(data) && isASCIIAlpha(data[index]) {
		index++
	}
	word := string(data[start:index])
	sign := 1
	if index < len(data) && data[index] == '-' {
		sign = -1
		index++
	}
	valueStart := index
	for index < len(data) && data[index] >= '0' && data[index] <= '9' {
		index++
	}
	value := 0
	hasValue := valueStart != index
	if hasValue {
		parsed, err := strconv.Atoi(string(data[valueStart:index]))
		if err == nil {
			value = parsed * sign
		}
	}
	if index < len(data) && data[index] != ' ' {
		index--
	}

	applyRTFControl(word, value, hasValue, state, builder, skipFallback)
	return index
}

func applyRTFControl(word string, value int, hasValue bool, state *rtfState, builder *strings.Builder, skipFallback *int) {
	if rtfSkipDestinations[word] {
		state.skip = true
		return
	}
	if state.skip {
		return
	}
	switch word {
	case "par", "line":
		builder.WriteByte('\n')
	case "tab":
		builder.WriteByte('\t')
	case "emdash":
		builder.WriteString("--")
	case "endash":
		builder.WriteByte('-')
	case "bullet":
		builder.WriteString("* ")
	case "uc":
		if hasValue && value >= 0 {
			state.uc = value
		}
	case "u":
		if hasValue {
			if value < 0 {
				value += 65536
			}
			builder.WriteRune(rune(value))
			*skipFallback = state.uc
		}
	}
}

func compactPreviewText(text string) string {
	lines := strings.Split(strings.ReplaceAll(text, "\u0000", ""), "\n")
	for index, line := range lines {
		lines[index] = strings.TrimSpace(line)
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func isASCIIAlpha(value byte) bool {
	return (value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z')
}

func parseHexByte(high byte, low byte) (byte, bool) {
	hi, ok := hexValue(high)
	if !ok {
		return 0, false
	}
	lo, ok := hexValue(low)
	if !ok {
		return 0, false
	}
	return hi<<4 | lo, true
}

func hexValue(value byte) (byte, bool) {
	switch {
	case value >= '0' && value <= '9':
		return value - '0', true
	case value >= 'a' && value <= 'f':
		return value - 'a' + 10, true
	case value >= 'A' && value <= 'F':
		return value - 'A' + 10, true
	default:
		return 0, false
	}
}

func readPrefix(path string, maxBytes int64) ([]byte, bool, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, false, fmt.Errorf("读取文件失败: %w", err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return nil, false, fmt.Errorf("读取文件内容失败: %w", err)
	}
	truncated := int64(len(data)) > maxBytes
	if truncated {
		data = data[:maxBytes]
	}
	return data, truncated, nil
}

func decodeText(data []byte) (string, string, bool) {
	if len(data) == 0 {
		return "", "utf-8", false
	}
	if bytes.HasPrefix(data, []byte{0xEF, 0xBB, 0xBF}) {
		data = data[3:]
	}
	if bytes.HasPrefix(data, []byte{0xFF, 0xFE}) {
		return decodeUTF16(data[2:], false), "utf-16le", false
	}
	if bytes.HasPrefix(data, []byte{0xFE, 0xFF}) {
		return decodeUTF16(data[2:], true), "utf-16be", false
	}
	if looksBinary(data) {
		return "", "", true
	}
	if utf8.Valid(data) {
		return string(data), "utf-8", false
	}
	return string(bytes.ToValidUTF8(data, []byte("�"))), "utf-8-lossy", false
}

func decodeUTF16(data []byte, bigEndian bool) string {
	if len(data)%2 == 1 {
		data = data[:len(data)-1]
	}
	units := make([]uint16, 0, len(data)/2)
	for index := 0; index < len(data); index += 2 {
		if bigEndian {
			units = append(units, uint16(data[index])<<8|uint16(data[index+1]))
		} else {
			units = append(units, uint16(data[index+1])<<8|uint16(data[index]))
		}
	}
	return string(utf16.Decode(units))
}

func looksBinary(data []byte) bool {
	if len(data) == 0 {
		return false
	}
	control := 0
	limit := minInt(len(data), 8192)
	for _, b := range data[:limit] {
		if b == 0 {
			return true
		}
		if b < 0x09 || (b > 0x0D && b < 0x20) {
			control++
		}
	}
	return control > limit/20
}

func formatJSONIfPossible(content string, jsonLines bool) string {
	if jsonLines {
		lines := strings.Split(content, "\n")
		for index, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			var value any
			if err := json.Unmarshal([]byte(line), &value); err != nil {
				return content
			}
			formatted, err := json.MarshalIndent(value, "", "  ")
			if err != nil {
				return content
			}
			lines[index] = string(formatted)
		}
		return strings.Join(lines, "\n")
	}
	var value any
	if err := json.Unmarshal([]byte(content), &value); err != nil {
		return content
	}
	formatted, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return content
	}
	return string(formatted)
}

func parseCSVPreview(content string) ([][]string, error) {
	reader := csv.NewReader(strings.NewReader(content))
	reader.FieldsPerRecord = -1
	rows := make([][]string, 0, 20)
	for len(rows) < 20 {
		row, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		if len(row) > DefaultMaxColumns {
			row = row[:DefaultMaxColumns]
		}
		rows = append(rows, row)
	}
	return rows, nil
}

func readDocxText(file *zip.File, maxBytes int64) (string, int64, bool, error) {
	reader, err := file.Open()
	if err != nil {
		return "", 0, false, fmt.Errorf("读取 DOCX 正文失败: %w", err)
	}
	defer reader.Close()
	decoder := xml.NewDecoder(io.LimitReader(reader, maxBytes+1))
	var builder strings.Builder
	var bytesRead int64
	truncated := false
	lastWasText := false
	for {
		token, err := decoder.Token()
		bytesRead = decoder.InputOffset()
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			if bytesRead >= maxBytes {
				truncated = true
				break
			}
			return "", bytesRead, truncated, fmt.Errorf("解析 DOCX 正文失败: %w", err)
		}
		if bytesRead > maxBytes {
			truncated = true
			break
		}
		switch item := token.(type) {
		case xml.StartElement:
			name := item.Name.Local
			if name == "p" && builder.Len() > 0 {
				builder.WriteByte('\n')
				lastWasText = false
			}
			if name == "tab" {
				builder.WriteByte('\t')
			}
		case xml.CharData:
			text := strings.TrimSpace(string(item))
			if text == "" {
				continue
			}
			if lastWasText {
				builder.WriteByte(' ')
			}
			builder.WriteString(text)
			lastWasText = true
		}
	}
	return strings.TrimSpace(builder.String()), bytesRead, truncated, nil
}

func readSharedStrings(files []*zip.File) ([]string, error) {
	file := findZipFile(files, "xl/sharedStrings.xml")
	if file == nil {
		return nil, nil
	}
	reader, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	decoder := xml.NewDecoder(reader)
	var values []string
	var builder strings.Builder
	inText := false
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return values, err
		}
		switch item := token.(type) {
		case xml.StartElement:
			if item.Name.Local == "t" {
				inText = true
			}
		case xml.EndElement:
			if item.Name.Local == "t" {
				inText = false
			}
			if item.Name.Local == "si" {
				values = append(values, builder.String())
				builder.Reset()
			}
		case xml.CharData:
			if inText {
				builder.WriteString(string(item))
			}
		}
	}
	return values, nil
}

func workbookSheetNames(files []*zip.File) []string {
	file := findZipFile(files, "xl/workbook.xml")
	if file == nil {
		return nil
	}
	reader, err := file.Open()
	if err != nil {
		return nil
	}
	defer reader.Close()
	decoder := xml.NewDecoder(reader)
	var names []string
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return names
		}
		start, ok := token.(xml.StartElement)
		if !ok || start.Name.Local != "sheet" {
			continue
		}
		for _, attr := range start.Attr {
			if attr.Name.Local == "name" {
				names = append(names, attr.Value)
				break
			}
		}
	}
	return names
}

func worksheetFiles(files []*zip.File) []*zip.File {
	var sheets []*zip.File
	for _, file := range files {
		if strings.HasPrefix(file.Name, "xl/worksheets/sheet") && strings.HasSuffix(file.Name, ".xml") {
			sheets = append(sheets, file)
		}
	}
	sort.Slice(sheets, func(i, j int) bool {
		return sheetIndex(sheets[i].Name) < sheetIndex(sheets[j].Name)
	})
	return sheets
}

func sheetIndex(name string) int {
	base := filepath.Base(name)
	base = strings.TrimSuffix(strings.TrimPrefix(base, "sheet"), ".xml")
	index, err := strconv.Atoi(base)
	if err != nil {
		return 0
	}
	return index
}

func readWorksheet(file *zip.File, sharedStrings []string) ([][]string, bool, error) {
	reader, err := file.Open()
	if err != nil {
		return nil, false, err
	}
	defer reader.Close()
	decoder := xml.NewDecoder(reader)
	rows := make([][]string, 0, DefaultMaxRows)
	var currentRow []string
	var currentType string
	var cellRef string
	var inValue bool
	var valueBuilder strings.Builder
	truncated := false
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return rows, truncated, err
		}
		switch item := token.(type) {
		case xml.StartElement:
			switch item.Name.Local {
			case "row":
				currentRow = nil
			case "c":
				currentType = ""
				cellRef = ""
				for _, attr := range item.Attr {
					if attr.Name.Local == "t" {
						currentType = attr.Value
					}
					if attr.Name.Local == "r" {
						cellRef = attr.Value
					}
				}
			case "v", "t":
				inValue = true
				valueBuilder.Reset()
			}
		case xml.EndElement:
			switch item.Name.Local {
			case "v", "t":
				inValue = false
			case "c":
				value := resolveCellValue(strings.TrimSpace(valueBuilder.String()), currentType, sharedStrings)
				currentRow = setCellValue(currentRow, cellRef, value)
			case "row":
				if len(rows) >= DefaultMaxRows {
					truncated = true
					return rows, truncated, nil
				}
				rows = append(rows, trimRow(currentRow))
			}
		case xml.CharData:
			if inValue {
				valueBuilder.WriteString(string(item))
			}
		}
	}
	return rows, truncated, nil
}

func resolveCellValue(raw string, cellType string, sharedStrings []string) string {
	if raw == "" {
		return ""
	}
	if cellType == "s" {
		index, err := strconv.Atoi(raw)
		if err == nil && index >= 0 && index < len(sharedStrings) {
			return sharedStrings[index]
		}
	}
	return raw
}

func setCellValue(row []string, ref string, value string) []string {
	column := len(row)
	if ref != "" {
		column = columnIndex(ref)
	}
	if column < 0 {
		column = len(row)
	}
	if column >= DefaultMaxColumns {
		return row
	}
	for len(row) <= column {
		row = append(row, "")
	}
	row[column] = value
	return row
}

func columnIndex(ref string) int {
	index := 0
	seen := false
	for _, r := range ref {
		if r < 'A' || r > 'Z' {
			break
		}
		seen = true
		index = index*26 + int(r-'A'+1)
	}
	if !seen {
		return -1
	}
	return index - 1
}

func trimRow(row []string) []string {
	end := len(row)
	for end > 0 && row[end-1] == "" {
		end--
	}
	if end == 0 {
		return []string{}
	}
	return row[:end]
}

func anySheetTruncated(sheets []SheetPreview) bool {
	for _, sheet := range sheets {
		if sheet.Truncated {
			return true
		}
	}
	return false
}

func findZipFile(files []*zip.File, name string) *zip.File {
	for _, file := range files {
		if file.Name == name {
			return file
		}
	}
	return nil
}

func asUnsupported(result Result, reason string) Result {
	result.Kind = KindUnsupported
	result.Status = "unsupported"
	result.Reason = reason
	return result
}

func fileURL(path string) string {
	slashPath := filepath.ToSlash(path)
	if filepath.VolumeName(path) != "" && !strings.HasPrefix(slashPath, "/") {
		slashPath = "/" + slashPath
	}
	return (&url.URL{Scheme: "file", Path: slashPath}).String()
}

func mimeByExtension(ext string) string {
	if ext == "" {
		return "application/octet-stream"
	}
	if value := mime.TypeByExtension(ext); value != "" {
		return value
	}
	switch ext {
	case ".md", ".markdown":
		return "text/markdown; charset=utf-8"
	case ".log":
		return "text/plain; charset=utf-8"
	case ".tsx", ".ts":
		return "text/typescript; charset=utf-8"
	case ".jsx", ".js":
		return "text/javascript; charset=utf-8"
	case ".webp":
		return "image/webp"
	case ".mkv":
		return "video/x-matroska"
	case ".flac":
		return "audio/flac"
	default:
		return "application/octet-stream"
	}
}

func textMime(ext string, encoding string) string {
	if ext == "" {
		return "text/plain; charset=" + encoding
	}
	value := mimeByExtension("." + ext)
	if strings.HasPrefix(value, "text/") || strings.Contains(value, "json") || strings.Contains(value, "xml") {
		if !strings.Contains(value, "charset=") {
			return value + "; charset=" + encoding
		}
		return value
	}
	return "text/plain; charset=" + encoding
}

func archiveMime(ext string) string {
	switch ext {
	case "jar":
		return "application/java-archive"
	case "epub":
		return "application/epub+zip"
	default:
		return "application/zip"
	}
}

func countLines(text string) int {
	if text == "" {
		return 0
	}
	return strings.Count(text, "\n") + 1
}

func set(values ...string) map[string]bool {
	result := make(map[string]bool, len(values))
	for _, value := range values {
		result[value] = true
	}
	return result
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
}

func isASCIIString(value string) bool {
	for index := 0; index < len(value); index++ {
		if value[index] >= utf8.RuneSelf {
			return false
		}
	}
	return true
}

func init() {
	// Windows 上 Go 的 mime 表可能缺少这些常见扩展，注册失败时忽略即可。
	_ = mime.AddExtensionType(".md", "text/markdown; charset=utf-8")
	_ = mime.AddExtensionType(".webp", "image/webp")
	_ = mime.AddExtensionType(".mkv", "video/x-matroska")
	_ = mime.AddExtensionType(".flac", "audio/flac")
	_ = time.Local
}
