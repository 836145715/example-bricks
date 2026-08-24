package main

import (
	"errors"
	"testing"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

func TestConnPoolReusesOneDialPerHost(t *testing.T) {
	dials := 0
	pool := newConnPool()
	pool.dial = func(host Host) (*ssh.Client, error) {
		dials++
		return nil, nil
	}

	first, err := pool.ensure(Host{ID: "h1"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := pool.ensure(Host{ID: "h1"})
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatal("same host should reuse pooled connection")
	}
	if dials != 1 {
		t.Fatalf("expected 1 dial, got %d", dials)
	}

	other, err := pool.ensure(Host{ID: "h2"})
	if err != nil {
		t.Fatal(err)
	}
	if other == first {
		t.Fatal("different host should not share connection")
	}
	if dials != 2 {
		t.Fatalf("expected 2 dials, got %d", dials)
	}
}

func TestConnPoolKeepsConnUntilLastTerminalCloses(t *testing.T) {
	dials := 0
	pool := newConnPool()
	pool.dial = func(Host) (*ssh.Client, error) {
		dials++
		return nil, nil
	}

	if _, err := pool.acquireTerminal(Host{ID: "h1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.acquireTerminal(Host{ID: "h1"}); err != nil {
		t.Fatal(err)
	}
	if dials != 1 {
		t.Fatalf("two terminals on one host should share one dial, got %d", dials)
	}

	pool.releaseTerminal("h1")
	kept, terminals, _ := pool.stats("h1")
	if !kept || terminals != 1 {
		t.Fatalf("first close should keep conn: kept=%v terminals=%d", kept, terminals)
	}

	pool.releaseTerminal("h1")
	kept, _, _ = pool.stats("h1")
	if kept {
		t.Fatal("last terminal should close pooled connection")
	}
}

func TestConnPoolReusesSFTPClient(t *testing.T) {
	opens := 0
	pool := newConnPool()
	pool.dial = func(Host) (*ssh.Client, error) { return nil, nil }
	pool.openSFTP = func(*ssh.Client) (*sftp.Client, error) {
		opens++
		return nil, errors.New("sftp opened")
	}

	_, err := pool.sftpFS(Host{ID: "h1"})
	if err == nil {
		t.Fatal("expected openSFTP error")
	}
	_, _ = pool.sftpFS(Host{ID: "h1"})
	if opens != 2 {
		t.Fatalf("failed open should not cache, got %d opens", opens)
	}

	cached := &sftp.Client{}
	opens = 0
	pool = newConnPool()
	pool.dial = func(Host) (*ssh.Client, error) { return nil, nil }
	pool.openSFTP = func(*ssh.Client) (*sftp.Client, error) {
		opens++
		return cached, nil
	}
	if _, err := pool.sftpFS(Host{ID: "h1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.sftpFS(Host{ID: "h1"}); err != nil {
		t.Fatal(err)
	}
	if opens != 1 {
		t.Fatalf("sftp client should be reused, opened %d times", opens)
	}
	kept, _, hasSFTP := pool.stats("h1")
	if !kept || !hasSFTP {
		t.Fatalf("cached sftp missing: kept=%v hasSFTP=%v", kept, hasSFTP)
	}
}

func TestConnPoolKeepsConnWhileTransferRuns(t *testing.T) {
	pool := newConnPool()
	pool.dial = func(Host) (*ssh.Client, error) { return nil, nil }

	if _, err := pool.acquireTerminal(Host{ID: "h1"}); err != nil {
		t.Fatal(err)
	}
	if err := pool.acquireTransfer(Host{ID: "h1"}); err != nil {
		t.Fatal(err)
	}
	pool.releaseTerminal("h1")
	kept, terminals, _ := pool.stats("h1")
	if !kept || terminals != 0 || pool.transferRefs("h1") != 1 {
		t.Fatalf("transfer should keep conn: kept=%v terminals=%d transfers=%d", kept, terminals, pool.transferRefs("h1"))
	}

	pool.releaseTransfer("h1")
	kept, _, _ = pool.stats("h1")
	if kept {
		t.Fatal("last transfer should close pooled connection")
	}
}

func TestConnPoolSFTPDoesNotCloseSharedConn(t *testing.T) {
	pool := newConnPool()
	pool.dial = func(Host) (*ssh.Client, error) { return nil, nil }
	pool.openSFTP = func(*ssh.Client) (*sftp.Client, error) {
		return nil, errors.New("no real sftp")
	}
	if _, err := pool.acquireTerminal(Host{ID: "h1"}); err != nil {
		t.Fatal(err)
	}
	_ = pool.useSFTP(Host{ID: "h1"}, func(remoteFS) error { return nil })
	kept, terminals, _ := pool.stats("h1")
	if !kept || terminals != 1 {
		t.Fatalf("sftp should not drop terminal conn: kept=%v terminals=%d", kept, terminals)
	}
}
