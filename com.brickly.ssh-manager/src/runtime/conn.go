package main

import (
	"strconv"
	"sync"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

func connKey(host Host) string {
	if host.ID != "" {
		return host.ID
	}
	return host.User + "@" + host.Host + ":" + strconv.Itoa(host.Port)
}

type pooledConn struct {
	hostID    string
	client    *ssh.Client
	sftp      *sftp.Client
	terminals int
	transfers int
}

type connPool struct {
	mu       sync.Mutex
	items    map[string]*pooledConn
	dial     func(Host) (*ssh.Client, error)
	openSFTP func(*ssh.Client) (*sftp.Client, error)
}

func newConnPool() *connPool {
	return &connPool{
		items: make(map[string]*pooledConn),
		dial:  dialSSH,
		openSFTP: func(client *ssh.Client) (*sftp.Client, error) {
			return sftp.NewClient(client)
		},
	}
}

func (p *connPool) has(hostID string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.items[hostID] != nil
}

func (p *connPool) ensure(host Host) (*pooledConn, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.ensureLocked(host)
}

func (p *connPool) ensureLocked(host Host) (*pooledConn, error) {
	key := connKey(host)
	if host.ID == "" && host.Host == "" {
		return nil, newInputError("hostId is required")
	}
	if conn := p.items[key]; conn != nil {
		return conn, nil
	}
	client, err := p.dial(host)
	if err != nil {
		return nil, newSSHError("SSH_CONNECT_ERROR", err.Error())
	}
	conn := &pooledConn{hostID: key, client: client}
	p.items[key] = conn
	return conn, nil
}

func (p *connPool) acquireTerminal(host Host) (*pooledConn, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	conn, err := p.ensureLocked(host)
	if err != nil {
		return nil, err
	}
	conn.terminals++
	return conn, nil
}

func (p *connPool) releaseTerminal(hostID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	conn := p.items[hostID]
	if conn == nil {
		return
	}
	if conn.terminals > 0 {
		conn.terminals--
	}
	p.maybeCloseLocked(hostID)
}

func (p *connPool) acquireTransfer(host Host) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	conn, err := p.ensureLocked(host)
	if err != nil {
		return err
	}
	conn.transfers++
	return nil
}

func (p *connPool) releaseTransfer(hostID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	conn := p.items[hostID]
	if conn == nil {
		return
	}
	if conn.transfers > 0 {
		conn.transfers--
	}
	p.maybeCloseLocked(hostID)
}

func (p *connPool) maybeCloseLocked(hostID string) {
	conn := p.items[hostID]
	if conn == nil {
		return
	}
	if conn.terminals == 0 && conn.transfers == 0 {
		p.closeLocked(hostID)
	}
}

func (p *connPool) client(host Host) (*ssh.Client, error) {
	conn, err := p.ensure(host)
	if err != nil {
		return nil, err
	}
	if conn.client == nil {
		return nil, newSSHError("SSH_CONNECT_ERROR", "ssh connection is missing")
	}
	return conn.client, nil
}

func (p *connPool) useSFTP(host Host, fn func(remoteFS) error) error {
	fsys, err := p.sftpFS(host)
	if err != nil {
		p.dropSFTP(host.ID)
		fsys, err = p.sftpFS(host)
		if err != nil {
			return err
		}
	}
	return fn(fsys)
}

func (p *connPool) sftpFS(host Host) (remoteFS, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	conn, err := p.ensureLocked(host)
	if err != nil {
		return nil, err
	}
	if conn.sftp == nil {
		client, err := p.openSFTP(conn.client)
		if err != nil {
			return nil, newSFTPError(err.Error())
		}
		conn.sftp = client
	}
	return &sftpRemote{client: conn.sftp}, nil
}

func (p *connPool) dropSFTP(hostID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	conn := p.items[hostID]
	if conn == nil || conn.sftp == nil {
		return
	}
	_ = conn.sftp.Close()
	conn.sftp = nil
}

func (p *connPool) evict(hostID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if conn := p.items[hostID]; conn != nil && (conn.terminals > 0 || conn.transfers > 0) {
		return
	}
	p.closeLocked(hostID)
}

func (p *connPool) closeAll() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for hostID := range p.items {
		p.closeLocked(hostID)
	}
}

func (p *connPool) closeLocked(hostID string) {
	conn := p.items[hostID]
	if conn == nil {
		return
	}
	delete(p.items, hostID)
	if conn.sftp != nil {
		_ = conn.sftp.Close()
		conn.sftp = nil
	}
	if conn.client != nil {
		_ = conn.client.Close()
		conn.client = nil
	}
}

func (p *connPool) stats(hostID string) (dialsKept bool, terminals int, hasSFTP bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	conn := p.items[hostID]
	if conn == nil {
		return false, 0, false
	}
	return true, conn.terminals, conn.sftp != nil
}

func (p *connPool) transferRefs(hostID string) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	conn := p.items[hostID]
	if conn == nil {
		return 0
	}
	return conn.transfers
}
