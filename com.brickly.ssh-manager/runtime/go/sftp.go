package main

import (
	"encoding/json"

	brickly "github.com/836145715/brickly-sdk-go"
)

func handleSftpList(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
	params, host, err := decodeSFTPRequest(input)
	if err != nil {
		return nil, err
	}
	var result listResult
	err = withSFTP(host, params.SessionID, func(fsys remoteFS) error {
		listed, listErr := listRemote(fsys, params.Path)
		if listErr != nil {
			return listErr
		}
		result = listed
		return nil
	})
	if err != nil {
		return nil, err
	}
	ctx.Info("列出远端目录", map[string]any{"hostId": host.ID, "path": result.Path})
	return result, nil
}

func handleSftpUpload(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
	params, host, err := decodeSFTPRequest(input)
	if err != nil {
		return nil, err
	}
	if params.LocalPath == "" {
		return nil, newInputError("localPath is required")
	}
	progress := newProgressEmitter(func(item transferProgress) {
		_ = ctx.Chunk("progress", item)
	})
	if conns.has(host.ID) {
		progress.setPhase("scanning", true)
	} else {
		progress.setPhase("connecting", true)
	}

	var result transferResult
	err = withSFTP(host, params.SessionID, func(fsys remoteFS) error {
		uploaded, uploadErr := uploadLocal(ctx.Context(), fsys, params.LocalPath, params.RemoteDir, params.Overwrite, progress)
		if uploadErr != nil {
			return uploadErr
		}
		result = uploaded
		return nil
	})
	if err != nil {
		return nil, err
	}
	_ = ctx.Output("result", result)
	ctx.Info("上传完成", map[string]any{"hostId": host.ID, "remotePath": result.RemotePath, "bytes": result.Bytes})
	return result, nil
}

func handleSftpDownload(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
	params, host, err := decodeSFTPRequest(input)
	if err != nil {
		return nil, err
	}
	if params.RemotePath == "" {
		return nil, newInputError("remotePath is required")
	}
	if params.LocalDir == "" {
		return nil, newInputError("localDir is required")
	}
	progress := newProgressEmitter(func(item transferProgress) {
		_ = ctx.Chunk("progress", item)
	})
	if conns.has(host.ID) {
		progress.setPhase("scanning", true)
	} else {
		progress.setPhase("connecting", true)
	}

	var result transferResult
	err = withSFTP(host, params.SessionID, func(fsys remoteFS) error {
		downloaded, downloadErr := downloadRemote(ctx.Context(), fsys, params.RemotePath, params.LocalDir, params.Overwrite, progress)
		if downloadErr != nil {
			return downloadErr
		}
		result = downloaded
		return nil
	})
	if err != nil {
		return nil, err
	}
	_ = ctx.Output("result", result)
	ctx.Info("下载完成", map[string]any{"hostId": host.ID, "remotePath": result.RemotePath, "bytes": result.Bytes})
	return result, nil
}

type sftpRequest struct {
	HostID     string `json:"hostId"`
	SessionID  string `json:"sessionId"`
	Path       string `json:"path"`
	LocalPath  string `json:"localPath"`
	RemoteDir  string `json:"remoteDir"`
	RemotePath string `json:"remotePath"`
	LocalDir   string `json:"localDir"`
	Overwrite  bool   `json:"overwrite"`
}

func decodeSFTPRequest(input json.RawMessage) (sftpRequest, Host, error) {
	var params sftpRequest
	if len(input) > 0 {
		if err := json.Unmarshal(input, &params); err != nil {
			return sftpRequest{}, Host{}, newInputError("invalid sftp input")
		}
	}
	if normalizeID(params.HostID) == "" {
		return sftpRequest{}, Host{}, newInputError("hostId is required")
	}
	host, err := resolveHost(hosts, params.HostID, nil)
	if err != nil {
		return sftpRequest{}, Host{}, err
	}
	return params, host, nil
}

func withSFTP(host Host, _ string, fn func(remoteFS) error) error {
	return conns.useSFTP(host, fn)
}
