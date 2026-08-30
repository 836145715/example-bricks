package main

import brickly "github.com/836145715/brickly-sdk-go"

func newInputError(message string) error {
	return brickly.NewBppError("INVALID_INPUT", message)
}

func newConfigError(message string) error {
	return brickly.NewBppError("CONFIG_ERROR", message)
}

func newNotFoundError(message string) error {
	return brickly.NewBppError("NOT_FOUND", message)
}

func newSSHError(code, message string) error {
	return brickly.NewBppError(code, message)
}

func newSFTPError(message string) error {
	return brickly.NewBppError("SFTP_ERROR", message)
}

func newExistsError(remotePath string) error {
	return brickly.NewBppError("SFTP_EXISTS", "远端已存在 "+remotePath)
}
