package Session

import (
	"fmt"
	"os"
	"path"
	"strconv"
	"strings"
	"time"
)

var splitBytes = []byte("*SunnyNetV4|.0.0.|SunnyNetV4*")

// ExportMessage writes websocket/TCP stream payloads to a temp .bin file.
func ExportMessage(app AppSession) (string, error) {
	tempDir := os.TempDir()
	filePath := path.Join(tempDir, "SunnyNet_"+strconv.Itoa(app.GetTheology())+".bin")
	_ = os.Remove(filePath)
	f, e := os.OpenFile(filePath, os.O_CREATE|os.O_RDWR|os.O_TRUNC, 0777)
	if e != nil {
		return "", e
	}
	defer f.Close()
	isWebsocket := app.IsWebsocket()
	tmpBytes := make([]byte, 1)
	app.RangeStream(func(obj AppStream) bool {
		if obj.GetIsSend() {
			t := fmt.Sprintf("%d", parseFormattedTimeToTimestamp(obj.GetMessageTime()))
			if len(t) < 13 {
				_, _ = f.WriteString("0000000000000")
			} else {
				_, _ = f.WriteString(t[0:13])
			}
			if isWebsocket {
				tmpBytes[0] = byte(obj.GetWebsocketType())
				_, _ = f.Write(tmpBytes[:])
			}
			_, _ = f.Write(obj.GetBody())
			_, _ = f.Write(splitBytes)
		}
		return true
	})
	return filePath, nil
}

func parseFormattedTimeToTimestamp(formatted string) int64 {
	parts := strings.Split(formatted, ":")
	if len(parts) != 2 {
		return 0
	}
	hmsPart := parts[0]
	msPart := parts[1]
	hmsFixed := strings.ReplaceAll(hmsPart, "-", ":")
	dateStr := time.Now().Format("2006-01-02")
	fullTimeStr := fmt.Sprintf("%s %s.%s", dateStr, hmsFixed, msPart)
	t, err := time.Parse("2006-01-02 15:04:05.000", fullTimeStr)
	if err != nil {
		return 0
	}
	return t.UnixNano() / int64(time.Millisecond)
}
