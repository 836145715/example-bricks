package walker

import (
	"encoding/binary"
	"errors"
)

// Darwin ATTR_* 位与 vtype 值。x/sys 已有同名常量（darwin only），
// 这里复制一份纯数值，让解析器可以在任何平台上单测。
// 来源：sys/attr.h、sys/vnode.h（macOS SDK）。
const (
	attrReturnedAttrs = 0x80000000 // 永远是返回 buffer 的第一个属性
	attrCommonName    = 0x1
	attrCommonFSID    = 0x4
	attrCommonObjType = 0x8
	attrCommonFlags   = 0x40000
	attrCommonFileID  = 0x2000000

	attrDirAllocSize  = 0x8
	attrDirDataLength = 0x20

	attrFileLinkCount = 0x1
	attrFileTotalSize = 0x2
	attrFileAllocSize = 0x4
)

// vtype（sys/vnode.h enum vtype）。
const (
	vObjNone = 0
	vObjReg  = 1
	vObjDir  = 2
	vObjBlk  = 3
	vObjChr  = 4
	vObjLnk  = 5
	vObjSock = 6
	vObjFifo = 7
)

// st_flags 位（sys/stat.h）。
const (
	flagUFImmutable = 0x2
	flagUFAppend    = 0x4
	flagSFImmutable = 0x20000
	flagSFAppend    = 0x40000
	flagSFDataless  = 0x40000000
)

// attributeSet 对应 sys/attr.h 的 attribute_set_t（返回位图，20 字节）。
type attributeSet struct {
	common uint32
	vol    uint32
	dir    uint32
	file   uint32
	fork   uint32
}

// AttrEntry 是一块 attrBuf 解析出的裸属性值。
type AttrEntry struct {
	Name      string
	ObjType   uint32
	Flags     uint32
	FSID      uint64
	FileID    uint64
	DirAlloc  int64
	DirData   int64
	FileLinks uint32
	FileTotal int64
	FileAlloc int64
}

var errTruncatedEntry = errors.New("attrbuf entry truncated")

// ParseEntry 解析 getattrlistbulk 返回的一条记录。
//
// 布局（man 2 getattrlist / sys/attr.h）：
//
//	[u32 总长度][attribute_set_t 返回位图 20B][各属性按位升序，4 字节对齐]
//
// ATTR_CMN_RETURNED_ATTRS 永远是第一个属性，其值就是返回位图；
// 可变长属性（NAME）用 attrreference_t{int32 offset, u32 length} 表示，
// offset 相对该引用自身。返回位图必是请求位图的子集，因此按请求位升序
// 逐个判断并消费即可，不会遇到未知属性。
func ParseEntry(buf []byte) (AttrEntry, error) {
	var out AttrEntry
	if len(buf) < 24 {
		return out, errTruncatedEntry
	}
	total := binary.LittleEndian.Uint32(buf[0:4])
	if total == 0 || int(total) > len(buf) {
		return out, errTruncatedEntry
	}
	entry := buf[:total]

	returned := attributeSet{
		common: binary.LittleEndian.Uint32(entry[4:8]),
		vol:    binary.LittleEndian.Uint32(entry[8:12]),
		dir:    binary.LittleEndian.Uint32(entry[12:16]),
		file:   binary.LittleEndian.Uint32(entry[16:20]),
		fork:   binary.LittleEndian.Uint32(entry[20:24]),
	}

	pos := 24
	// commonattr 位升序消费。
	for _, bit := range []uint32{attrCommonName, attrCommonFSID, attrCommonObjType, attrCommonFlags, attrCommonFileID} {
		if returned.common&bit == 0 {
			continue
		}
		pos = align4(pos)
		if pos+8 > len(entry) {
			return out, errTruncatedEntry
		}
		switch bit {
		case attrCommonName:
			dataoff := int32(binary.LittleEndian.Uint32(entry[pos : pos+4]))
			datalen := binary.LittleEndian.Uint32(entry[pos+4 : pos+8])
			start := int(int64(pos) + int64(dataoff))
			if dataoff < 0 || start < 0 || start+int(datalen) > len(entry) {
				return out, errTruncatedEntry
			}
			out.Name = cstring(entry[start : start+int(datalen)])
			pos += 8
		case attrCommonFSID:
			// fsid_t 是 {int32 val[2]}；与 statfs 的 f_fsid.val[0] 同口径取低 32 位。
			out.FSID = uint64(binary.LittleEndian.Uint32(entry[pos : pos+4]))
			pos += 8
		case attrCommonObjType:
			out.ObjType = binary.LittleEndian.Uint32(entry[pos : pos+4])
			pos += 4
		case attrCommonFlags:
			out.Flags = binary.LittleEndian.Uint32(entry[pos : pos+4])
			pos += 4
		case attrCommonFileID:
			out.FileID = binary.LittleEndian.Uint64(entry[pos : pos+8])
			pos += 8
		}
	}
	// dirattr 位升序。
	for _, bit := range []uint32{attrDirAllocSize, attrDirDataLength} {
		if returned.dir&bit == 0 {
			continue
		}
		pos = align4(pos)
		if pos+8 > len(entry) {
			return out, errTruncatedEntry
		}
		v := int64(binary.LittleEndian.Uint64(entry[pos : pos+8]))
		pos += 8
		if bit == attrDirAllocSize {
			out.DirAlloc = v
		} else {
			out.DirData = v
		}
	}
	// fileattr 位升序。LINKCOUNT 是 nlink_t（u16），其余 8 字节。
	for _, bit := range []uint32{attrFileLinkCount, attrFileTotalSize, attrFileAllocSize} {
		if returned.file&bit == 0 {
			continue
		}
		pos = align4(pos)
		switch bit {
		case attrFileLinkCount:
			if pos+2 > len(entry) {
				return out, errTruncatedEntry
			}
			out.FileLinks = uint32(binary.LittleEndian.Uint16(entry[pos : pos+2]))
			pos += 2
		default:
			if pos+8 > len(entry) {
				return out, errTruncatedEntry
			}
			v := int64(binary.LittleEndian.Uint64(entry[pos : pos+8]))
			if bit == attrFileTotalSize {
				out.FileTotal = v
			} else {
				out.FileAlloc = v
			}
			pos += 8
		}
	}
	return out, nil
}

func align4(n int) int {
	return (n + 3) &^ 3
}

func cstring(b []byte) string {
	for i, c := range b {
		if c == 0 {
			return string(b[:i])
		}
	}
	return string(b)
}
