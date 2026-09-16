package walker

import (
	"encoding/binary"
	"testing"
)

// attrBuilder 模拟内核打包一条 getattrlistbulk 记录：长度前缀 + 返回位图 + 按位升序的属性值。
type attrBuilder struct {
	bits     map[uint32][]byte // group -> 该组实际返回的位（用于构造位图）
	common   map[uint32][]byte
	dir      map[uint32][]byte
	file     map[uint32][]byte
	returned attributeSet
}

func newAttrBuilder() *attrBuilder {
	return &attrBuilder{
		common: map[uint32][]byte{},
		dir:    map[uint32][]byte{},
		file:   map[uint32][]byte{},
	}
}

func put32(v uint32) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, v)
	return b
}

func put64(v uint64) []byte {
	b := make([]byte, 8)
	binary.LittleEndian.PutUint64(b, v)
	return b
}

func (ab *attrBuilder) setReturned() attributeSet {
	cs, ds, fs := uint32(0), uint32(0), uint32(0)
	for bit := range ab.common {
		cs |= bit
	}
	for bit := range ab.dir {
		ds |= bit
	}
	for bit := range ab.file {
		fs |= bit
	}
	return attributeSet{common: cs, dir: ds, file: fs}
}

// build 打包一条记录，布局对齐内核：定长属性按位升序在前，
// NAME 的 attrreference 占其位，变长名字数据统一放在条目末尾（4 对齐）。
func (ab *attrBuilder) build(name string) []byte {
	var body []byte
	nameRefStart := -1
	// commonattr 位升序
	for _, bit := range []uint32{attrCommonName, attrCommonFSID, attrCommonObjType, attrCommonFlags, attrCommonFileID} {
		if _, ok := ab.common[bit]; !ok {
			continue
		}
		for len(body)%4 != 0 {
			body = append(body, 0)
		}
		if bit == attrCommonName {
			nameRefStart = len(body)
			body = append(body, make([]byte, 8)...) // 引用稍后回填
		} else {
			body = append(body, ab.common[bit]...)
		}
	}
	for _, bit := range []uint32{attrDirAllocSize, attrDirDataLength} {
		if _, ok := ab.dir[bit]; !ok {
			continue
		}
		for len(body)%4 != 0 {
			body = append(body, 0)
		}
		body = append(body, ab.dir[bit]...)
	}
	for _, bit := range []uint32{attrFileLinkCount, attrFileTotalSize, attrFileAllocSize} {
		if _, ok := ab.file[bit]; !ok {
			continue
		}
		for len(body)%4 != 0 {
			body = append(body, 0)
		}
		body = append(body, ab.file[bit]...)
	}
	// 变长名字数据追加在条目末尾。
	for len(body)%4 != 0 {
		body = append(body, 0)
	}
	nameStart := len(body)
	body = append(body, name...)
	body = append(body, 0)
	if nameRefStart >= 0 {
		ref := make([]byte, 8)
		binary.LittleEndian.PutUint32(ref[0:4], uint32(nameStart-nameRefStart))
		binary.LittleEndian.PutUint32(ref[4:8], uint32(len(name)+1))
		copy(body[nameRefStart:nameRefStart+8], ref)
	}
	// 头：总长度 + 返回位图（20B）
	ret := ab.setReturned()
	head := make([]byte, 24)
	binary.LittleEndian.PutUint32(head[0:4], uint32(24+len(body)))
	binary.LittleEndian.PutUint32(head[4:8], ret.common)
	binary.LittleEndian.PutUint32(head[8:12], ret.vol)
	binary.LittleEndian.PutUint32(head[12:16], ret.dir)
	binary.LittleEndian.PutUint32(head[16:20], ret.file)
	binary.LittleEndian.PutUint32(head[20:24], ret.fork)
	return append(head, body...)
}

func TestParseEntryFile(t *testing.T) {
	ab := newAttrBuilder()
	ab.common[attrCommonName] = nil
	ab.common[attrCommonFSID] = put64(0x1122)
	ab.common[attrCommonObjType] = put32(vObjReg)
	ab.common[attrCommonFlags] = put32(flagUFImmutable)
	ab.common[attrCommonFileID] = put64(42)
	ab.file[attrFileLinkCount] = put32(2)[:2] // nlink_t 是 u16
	ab.file[attrFileTotalSize] = put64(1000)
	ab.file[attrFileAllocSize] = put64(4096)

	buf := ab.build("hello.txt")
	got, err := ParseEntry(buf)
	if err != nil {
		t.Fatalf("ParseEntry: %v", err)
	}
	if got.Name != "hello.txt" {
		t.Errorf("Name = %q", got.Name)
	}
	if got.ObjType != vObjReg || got.FSID != 0x1122 || got.FileID != 42 {
		t.Errorf("identity = %+v", got)
	}
	if got.Flags&flagUFImmutable == 0 {
		t.Errorf("Flags = %#x, want UF_IMMUTABLE bit", got.Flags)
	}
	if got.FileLinks != 2 || got.FileTotal != 1000 || got.FileAlloc != 4096 {
		t.Errorf("file attrs = %+v", got)
	}
}

func TestParseEntryDir(t *testing.T) {
	ab := newAttrBuilder()
	ab.common[attrCommonName] = nil
	ab.common[attrCommonObjType] = put32(vObjDir)
	ab.common[attrCommonFileID] = put64(7)
	ab.dir[attrDirAllocSize] = put64(8192)
	ab.dir[attrDirDataLength] = put64(680)

	got, err := ParseEntry(ab.build("目录名"))
	if err != nil {
		t.Fatalf("ParseEntry: %v", err)
	}
	if got.Name != "目录名" {
		t.Errorf("Name = %q, want unicode dir name", got.Name)
	}
	if got.ObjType != vObjDir {
		t.Errorf("ObjType = %d", got.ObjType)
	}
	if got.DirAlloc != 8192 || got.DirData != 680 {
		t.Errorf("dir attrs = %+v", got)
	}
	if got.FileAlloc != 0 || got.FileTotal != 0 {
		t.Errorf("file attrs should be zero on dir: %+v", got)
	}
}

func TestParseEntrySkipsMissingAttrs(t *testing.T) {
	// 返回位图缺 OBJTYPE 与 FILE_LINKCOUNT：解析应跳过它们而不串位。
	ab := newAttrBuilder()
	ab.common[attrCommonName] = nil
	ab.common[attrCommonFlags] = put32(0)
	ab.common[attrCommonFileID] = put64(9)
	ab.file[attrFileTotalSize] = put64(512)
	ab.file[attrFileAllocSize] = put64(4096)

	got, err := ParseEntry(ab.build("partial"))
	if err != nil {
		t.Fatalf("ParseEntry: %v", err)
	}
	if got.Name != "partial" || got.FileID != 9 || got.FileTotal != 512 || got.FileAlloc != 4096 {
		t.Errorf("parsed = %+v", got)
	}
}

func TestParseEntryTruncated(t *testing.T) {
	ab := newAttrBuilder()
	ab.common[attrCommonName] = nil
	ab.common[attrCommonFileID] = put64(9)
	buf := ab.build("x")
	// 截掉一半固定属性，但长度前缀仍声称完整。
	if _, err := ParseEntry(buf[:len(buf)-4]); err == nil {
		t.Fatalf("expected truncation error, got nil")
	}
	// 长度前缀为 0 也应报错。
	bad := make([]byte, 24)
	if _, err := ParseEntry(bad); err == nil {
		t.Fatalf("expected error for zero length, got nil")
	}
}

func TestParseEntryLongName(t *testing.T) {
	ab := newAttrBuilder()
	ab.common[attrCommonName] = nil
	ab.common[attrCommonObjType] = put32(vObjReg)
	name := ""
	for i := 0; i < 60; i++ {
		name += "名字" // 180 字节 UTF-8，超过 NAME_MAX 的 60 个汉字
	}
	got, err := ParseEntry(ab.build(name))
	if err != nil {
		t.Fatalf("ParseEntry: %v", err)
	}
	if got.Name != name {
		t.Errorf("long name mismatch: got %d bytes, want %d", len(got.Name), len(name))
	}
}

func TestKindFromObjTypeAndFlags(t *testing.T) {
	cases := []struct {
		obj  uint32
		want modelKind
	}{
		{vObjReg, kindFile},
		{vObjDir, kindDir},
		{vObjLnk, kindLink},
		{vObjSock, kindOther},
		{vObjFifo, kindOther},
		{vObjBlk, kindOther},
		{vObjChr, kindOther},
		{vObjNone, kindOther},
	}
	for _, c := range cases {
		if got := kindFromObjType(c.obj); got != c.want {
			t.Errorf("kindFromObjType(%d) = %v, want %v", c.obj, got, c.want)
		}
	}
}
