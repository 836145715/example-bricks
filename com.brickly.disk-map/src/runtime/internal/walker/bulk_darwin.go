//go:build darwin

package walker

import (
	"unsafe"

	"golang.org/x/sys/unix"
)

// bulkAttrList 构造 getattrlistbulk 请求位图。
// ATTR_DIR_* 与 RETURNED_ATTRS 的取值以 sys/attr.h 为准（x/sys 未覆盖 DIR 组）。
func bulkAttrList() *unix.Attrlist {
	return &unix.Attrlist{
		Bitmapcount: 5,
		Commonattr: unix.ATTR_CMN_RETURNED_ATTRS |
			unix.ATTR_CMN_NAME |
			unix.ATTR_CMN_FSID |
			unix.ATTR_CMN_OBJTYPE |
			unix.ATTR_CMN_FLAGS |
			unix.ATTR_CMN_FILEID,
		Dirattr:  attrDirAllocSize | attrDirDataLength,
		Fileattr: unix.ATTR_FILE_LINKCOUNT | unix.ATTR_FILE_TOTALSIZE | unix.ATTR_FILE_ALLOCSIZE,
	}
}

// bulkRead 一次 syscall 吃一整页目录项，返回本批条数；0 表示目录读完。
func bulkRead(fd int, attrList *unix.Attrlist, buf []byte) (int, error) {
	n, _, errno := unix.Syscall6(
		unix.SYS_GETATTRLISTBULK,
		uintptr(fd),
		uintptr(unsafe.Pointer(attrList)),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)),
		uintptr(unix.FSOPT_RETURN_REALDEV),
		0,
	)
	if errno != 0 {
		return 0, errno
	}
	return int(n), nil
}

// rootFSID 读取扫描根所在卷的 fsid（用于跨卷判断）。
func rootFSID(path string) (uint64, error) {
	var st unix.Statfs_t
	if err := unix.Statfs(path, &st); err != nil {
		return 0, err
	}
	return uint64(st.Fsid.Val[0]), nil
}
