package main

import (
	"errors"
	"fmt"
	"net"
	"os"
	"strconv"
	"time"

	"golang.org/x/crypto/ssh"
)

const defaultDialTimeout = 10 * time.Second

func dialSSH(host Host) (*ssh.Client, error) {
	auths, err := buildAuthMethods(host)
	if err != nil {
		return nil, err
	}
	config := &ssh.ClientConfig{
		User:            host.User,
		Auth:            auths,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         defaultDialTimeout,
	}
	addr := net.JoinHostPort(host.Host, strconv.Itoa(host.Port))
	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		return nil, fmt.Errorf("ssh connection failed: %w", err)
	}
	return client, nil
}

func buildAuthMethods(host Host) ([]ssh.AuthMethod, error) {
	if host.AuthType == authKey {
		signer, err := parsePrivateKey(host)
		if err != nil {
			return nil, err
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil
	}
	return []ssh.AuthMethod{ssh.Password(host.Password)}, nil
}

func parsePrivateKey(host Host) (ssh.Signer, error) {
	keyBytes, err := readPrivateKeyBytes(host)
	if err != nil {
		return nil, err
	}
	if host.Passphrase != "" {
		signer, err := ssh.ParsePrivateKeyWithPassphrase(keyBytes, []byte(host.Passphrase))
		if err != nil {
			return nil, fmt.Errorf("failed to parse private key: %w", err)
		}
		return signer, nil
	}
	signer, err := ssh.ParsePrivateKey(keyBytes)
	if err != nil {
		var missing *ssh.PassphraseMissingError
		if errors.As(err, &missing) {
			return nil, errors.New("private key requires passphrase")
		}
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}
	return signer, nil
}

func readPrivateKeyBytes(host Host) ([]byte, error) {
	if host.KeyText != "" {
		return []byte(host.KeyText), nil
	}
	if host.KeyPath == "" {
		return nil, errors.New("private key is empty")
	}
	data, err := os.ReadFile(host.KeyPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read private key file: %w", err)
	}
	return data, nil
}

func resolveHost(store *configStore, hostID string, rawHost any) (Host, error) {
	if rawHost != nil {
		return decodeHost(rawHost)
	}
	hostID = normalizeID(hostID)
	if hostID == "" {
		return Host{}, newInputError("hostId or host is required")
	}
	host, ok, err := store.Get(hostID)
	if err != nil {
		return Host{}, newConfigError(err.Error())
	}
	if !ok {
		return Host{}, newNotFoundError("host not found")
	}
	return host, nil
}
