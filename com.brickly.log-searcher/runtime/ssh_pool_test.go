package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func startTestSSHServer(t *testing.T) (host string, port int, stop func()) {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatalf("signer: %v", err)
	}

	config := &ssh.ServerConfig{
		PasswordCallback: func(ssh.ConnMetadata, []byte) (*ssh.Permissions, error) {
			return nil, nil
		},
	}
	config.AddHostKey(signer)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	done := make(chan struct{})
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func(nConn net.Conn) {
				sConn, chans, reqs, err := ssh.NewServerConn(nConn, config)
				if err != nil {
					_ = nConn.Close()
					return
				}
				defer sConn.Close()
				go ssh.DiscardRequests(reqs)
				for newChannel := range chans {
					if newChannel.ChannelType() != "session" {
						_ = newChannel.Reject(ssh.UnknownChannelType, "unknown")
						continue
					}
					channel, requests, err := newChannel.Accept()
					if err != nil {
						continue
					}
					go func() {
						for req := range requests {
							if req.WantReply {
								_ = req.Reply(true, nil)
							}
							if req.Type == "exec" {
								_, _ = channel.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{0}))
								_ = channel.Close()
							}
						}
					}()
				}
			}(conn)
		}
	}()

	addr := listener.Addr().String()
	host, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("split addr: %v", err)
	}
	port, err = strconv.Atoi(portStr)
	if err != nil {
		t.Fatalf("port: %v", err)
	}

	stop = func() {
		_ = listener.Close()
		close(done)
	}
	return host, port, stop
}

func testServerConfig(host string, port int, password string) ServerConfig {
	return ServerConfig{
		Host:     host,
		Port:     port,
		User:     "tester",
		AuthType: "password",
		Password: password,
	}
}

func TestSSHConnPoolReusesClientForSameFingerprint(t *testing.T) {
	host, port, stop := startTestSSHServer(t)
	defer stop()

	pool := newSSHConnPool()
	pool.idleFor = time.Minute
	server := testServerConfig(host, port, "secret")

	first, releaseFirst, err := pool.Acquire(context.Background(), server)
	if err != nil {
		t.Fatalf("first acquire: %v", err)
	}
	second, releaseSecond, err := pool.Acquire(context.Background(), server)
	if err != nil {
		t.Fatalf("second acquire: %v", err)
	}
	if first != second {
		t.Fatal("same credentials should reuse one SSH client")
	}
	releaseFirst()
	releaseSecond()
}

func TestSSHConnKeyChangesWithPassword(t *testing.T) {
	left := sshConnKey(testServerConfig("h", 22, "a"))
	right := sshConnKey(testServerConfig("h", 22, "b"))
	if left == right {
		t.Fatal("different passwords must not share a pool key")
	}
	if !strings.Contains(left, "tester@h:22") {
		t.Fatalf("key should include user/host/port, got %q", left)
	}
}

func TestSSHConnPoolIdlesOutUnusedClient(t *testing.T) {
	host, port, stop := startTestSSHServer(t)
	defer stop()

	pool := newSSHConnPool()
	pool.idleFor = 40 * time.Millisecond
	server := testServerConfig(host, port, "secret")

	client, release, err := pool.Acquire(context.Background(), server)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	release()

	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		pool.mu.Lock()
		_, exists := pool.clients[client]
		pool.mu.Unlock()
		if !exists {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("idle client should have been closed")
}
