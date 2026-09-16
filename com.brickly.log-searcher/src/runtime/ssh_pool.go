package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

const (
	sshTCPTimeout         = 5 * time.Second
	sshHandshakeTimeout   = 8 * time.Second
	sshIdleTimeout        = 5 * time.Minute
	sshKeepAliveInterval  = 30 * time.Second
	sshKeepAlivePeriodTCP = 30 * time.Second
)

type pooledSSH struct {
	key       string
	client    *ssh.Client
	refs      int
	dead      bool
	stop      chan struct{}
	idleTimer *time.Timer
}

type sshConnPool struct {
	mu      sync.Mutex
	conns   map[string]*pooledSSH
	clients map[*ssh.Client]*pooledSSH
	dialing map[string]chan struct{}
	idleFor time.Duration
}

func newSSHConnPool() *sshConnPool {
	return &sshConnPool{
		conns:   make(map[string]*pooledSSH),
		clients: make(map[*ssh.Client]*pooledSSH),
		dialing: make(map[string]chan struct{}),
		idleFor: sshIdleTimeout,
	}
}

var sshClients = newSSHConnPool()

func sshConnKey(server ServerConfig) string {
	port := server.Port
	if port <= 0 {
		port = 22
	}
	secret := server.Password
	if server.AuthType == "key" {
		if server.KeyText != "" {
			secret = server.KeyText
		} else {
			secret = server.KeyPath
		}
	}
	sum := sha256.Sum256([]byte(secret))
	return fmt.Sprintf("%s@%s:%d|%s|%x", server.User, server.Host, port, server.AuthType, sum)
}

func acquireSSHClient(ctx context.Context, server ServerConfig) (*ssh.Client, func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	return sshClients.Acquire(ctx, server)
}

func invalidateSSHClient(client *ssh.Client) {
	sshClients.InvalidateClient(client)
}

func openSSHSession(client *ssh.Client) (*ssh.Session, error) {
	session, err := client.NewSession()
	if err != nil {
		invalidateSSHClient(client)
		return nil, err
	}
	return session, nil
}

func (pool *sshConnPool) Acquire(ctx context.Context, server ServerConfig) (*ssh.Client, func(), error) {
	key := sshConnKey(server)
	for {
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}

		pool.mu.Lock()
		if entry := pool.conns[key]; entry != nil && !entry.dead {
			if entry.idleTimer != nil {
				entry.idleTimer.Stop()
				entry.idleTimer = nil
			}
			entry.refs++
			client := entry.client
			pool.mu.Unlock()
			return client, func() { pool.release(key) }, nil
		}

		if wait := pool.dialing[key]; wait != nil {
			pool.mu.Unlock()
			select {
			case <-ctx.Done():
				return nil, nil, ctx.Err()
			case <-wait:
			}
			continue
		}

		done := make(chan struct{})
		pool.dialing[key] = done
		pool.mu.Unlock()

		client, err := dialSSHClient(server)

		pool.mu.Lock()
		close(done)
		delete(pool.dialing, key)
		if err != nil {
			pool.mu.Unlock()
			return nil, nil, err
		}

		entry := &pooledSSH{
			key:    key,
			client: client,
			refs:   1,
			stop:   make(chan struct{}),
		}
		pool.conns[key] = entry
		pool.clients[client] = entry
		pool.mu.Unlock()

		go pool.watch(entry)
		go pool.keepAlive(entry)
		return client, func() { pool.release(key) }, nil
	}
}

func (pool *sshConnPool) release(key string) {
	pool.mu.Lock()
	defer pool.mu.Unlock()
	entry := pool.conns[key]
	if entry == nil || entry.dead {
		return
	}
	if entry.refs > 0 {
		entry.refs--
	}
	if entry.refs != 0 {
		return
	}
	if entry.idleTimer != nil {
		entry.idleTimer.Stop()
	}
	idleFor := pool.idleFor
	entry.idleTimer = time.AfterFunc(idleFor, func() {
		pool.closeIfIdle(key)
	})
}

func (pool *sshConnPool) closeIfIdle(key string) {
	pool.mu.Lock()
	defer pool.mu.Unlock()
	entry := pool.conns[key]
	if entry == nil || entry.dead || entry.refs > 0 {
		return
	}
	pool.closeEntryLocked(entry)
}

func (pool *sshConnPool) InvalidateClient(client *ssh.Client) {
	pool.mu.Lock()
	defer pool.mu.Unlock()
	entry := pool.clients[client]
	if entry == nil || entry.dead {
		return
	}
	pool.closeEntryLocked(entry)
}

func (pool *sshConnPool) watch(entry *pooledSSH) {
	_ = entry.client.Wait()
	pool.InvalidateClient(entry.client)
}

func (pool *sshConnPool) keepAlive(entry *pooledSSH) {
	ticker := time.NewTicker(sshKeepAliveInterval)
	defer ticker.Stop()
	for {
		select {
		case <-entry.stop:
			return
		case <-ticker.C:
			_, _, err := entry.client.SendRequest("keepalive@openssh.com", true, nil)
			if err != nil {
				pool.InvalidateClient(entry.client)
				return
			}
		}
	}
}

func (pool *sshConnPool) closeEntryLocked(entry *pooledSSH) {
	if entry.dead {
		return
	}
	entry.dead = true
	if entry.idleTimer != nil {
		entry.idleTimer.Stop()
		entry.idleTimer = nil
	}
	select {
	case <-entry.stop:
	default:
		close(entry.stop)
	}
	delete(pool.conns, entry.key)
	delete(pool.clients, entry.client)
	_ = entry.client.Close()
}

func applyTCPKeepAlive(conn net.Conn) {
	tcp, ok := conn.(*net.TCPConn)
	if !ok {
		return
	}
	_ = tcp.SetKeepAlive(true)
	_ = tcp.SetKeepAlivePeriod(sshKeepAlivePeriodTCP)
}
