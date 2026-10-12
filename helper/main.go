// Mullvad Domain Split home-IP helper. Bind only to the IPv4 loopback interface.
// Compile for Windows with Go (no third-party dependencies).
package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	proxyAddress  = "127.0.0.1:37651"
	healthAddress = "127.0.0.1:37652"
)

func main() {
	check := flag.Bool("check", false, "show whether helper is running")
	flag.Parse()
	if *check {
		client := &http.Client{Timeout: 2 * time.Second}
		response, err := client.Get("http://" + healthAddress + "/health")
		if err != nil {
			fmt.Fprintln(os.Stderr, "Helper not running:", err)
			os.Exit(1)
		}
		defer response.Body.Close()
		io.Copy(os.Stdout, response.Body)
		return
	}
	ln, err := net.Listen("tcp4", proxyAddress)
	if err != nil {
		log.Fatal("Cannot bind SOCKS proxy (is another copy running?): ", err)
	}
	server := &http.Server{Addr: healthAddress, ReadHeaderTimeout: 3 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" || r.Method != "GET" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(map[string]interface{}{"running": true, "service": "Mullvad Home IP Helper", "proxy": "SOCKS5 127.0.0.1:37651", "version": "1.0.0"})
	})}
	// Abort startup if the health port isn't available; do not leave half-functioning helper.
	hl, err := net.Listen("tcp4", healthAddress)
	if err != nil {
		ln.Close()
		log.Fatal("Cannot bind health server: ", err)
	}
	log.Printf("SOCKS5 home-IP proxy on %s; health at http://%s/health", proxyAddress, healthAddress)
	log.Println("IMPORTANT: In Mullvad VPN > Settings > Split tunneling > Find another app, EXCLUDE this executable; leave the browser inside the VPN.")
	log.Println("This helper forwards traffic over the Windows network route of THIS executable. Verify your real IP before relying on it.")
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		if err := server.Serve(hl); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Println("Health server:", err)
		}
	}()
	go func() { <-ctx.Done(); ln.Close(); server.Shutdown(context.Background()) }()
	var wg sync.WaitGroup
	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				break
			}
			if ne, ok := err.(net.Error); ok && ne.Temporary() {
				time.Sleep(100 * time.Millisecond)
				continue
			}
			log.Println("Accept:", err)
			break
		}
		wg.Add(1)
		go func() { defer wg.Done(); serveSocks(conn) }()
	}
	wg.Wait()
}

func reply(w net.Conn, code byte) {
	// SOCKS5 IPv4 0.0.0.0:0 bind address (Chrome does not use BND.ADDR).
	w.Write([]byte{5, code, 0, 1, 0, 0, 0, 0, 0, 0})
}
func serveSocks(conn net.Conn) {
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(15 * time.Second))
	h := make([]byte, 2)
	if _, err := io.ReadFull(conn, h); err != nil || h[0] != 5 || h[1] == 0 {
		return
	}
	methods := make([]byte, int(h[1]))
	if _, err := io.ReadFull(conn, methods); err != nil {
		return
	}
	noAuth := false
	for _, v := range methods {
		if v == 0 {
			noAuth = true
		}
	}
	if !noAuth {
		conn.Write([]byte{5, 0xff})
		return
	}
	if _, err := conn.Write([]byte{5, 0}); err != nil {
		return
	}
	head := make([]byte, 4)
	if _, err := io.ReadFull(conn, head); err != nil || head[0] != 5 {
		return
	}
	if head[1] != 1 {
		reply(conn, 7)
		return
	} // CONNECT only, no UDP/BIND.
	var host string
	switch head[3] {
	case 1:
		b := make([]byte, 4)
		if _, err := io.ReadFull(conn, b); err != nil {
			return
		}
		host = net.IP(b).String()
	case 4:
		b := make([]byte, 16)
		if _, err := io.ReadFull(conn, b); err != nil {
			return
		}
		host = net.IP(b).String()
	case 3:
		n := make([]byte, 1)
		if _, err := io.ReadFull(conn, n); err != nil || n[0] == 0 {
			return
		}
		b := make([]byte, int(n[0]))
		if _, err := io.ReadFull(conn, b); err != nil {
			return
		}
		host = string(b)
	default:
		reply(conn, 8)
		return
	}
	p := make([]byte, 2)
	if _, err := io.ReadFull(conn, p); err != nil {
		return
	}
	port := int(binary.BigEndian.Uint16(p))
	if port == 0 || strings.ContainsAny(host, "\x00\r\n\t") {
		reply(conn, 8)
		return
	}
	// Resolve through this helper process, not the Chromium process. Explicitly
	// refuse nonpublic destination addresses (including LAN and loopback).
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		reply(conn, 4)
		return
	}
	var candidates []string
	for _, record := range ips {
		if isPublic(record.IP) {
			candidates = append(candidates, record.IP.String())
		}
	}
	if len(candidates) == 0 {
		reply(conn, 2)
		return
	}
	var remote net.Conn
	dialer := net.Dialer{Timeout: 8 * time.Second, KeepAlive: 30 * time.Second}
	for _, candidate := range candidates {
		remote, err = dialer.DialContext(ctx, "tcp", net.JoinHostPort(candidate, strconv.Itoa(port)))
		if err == nil {
			break
		}
	}
	if err != nil {
		reply(conn, 5)
		return
	}
	defer remote.Close()
	if _, err := conn.Write([]byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0}); err != nil {
		return
	}
	conn.SetDeadline(time.Time{})
	remote.SetDeadline(time.Time{})
	var wg sync.WaitGroup
	wg.Add(2)
	// On EOF, half-close the corresponding TCP write direction to avoid hanging
	// TLS connections while allowing the other direction to drain.
	pipe := func(dst net.Conn, src net.Conn) {
		defer wg.Done()
		io.Copy(dst, src)
		if tcp, ok := dst.(*net.TCPConn); ok {
			tcp.CloseWrite()
		}
		if tcp, ok := src.(*net.TCPConn); ok {
			tcp.CloseRead()
		}
	}
	go pipe(remote, conn)
	go pipe(conn, remote)
	wg.Wait()
}
func isPublic(ip net.IP) bool {
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		// Additionally exclude shared, documentation, benchmarking and other
		// special-use IPv4 address space that IsGlobalUnicast doesn't reject.
		a, b, c := v4[0], v4[1], v4[2]
		if a == 0 || a == 10 || a == 127 || a >= 224 || a == 169 && b == 254 || a == 100 && b >= 64 && b <= 127 ||
			a == 192 && b == 0 && c == 0 || a == 192 && b == 0 && c == 2 || a == 198 && b == 18 || a == 198 && b == 19 ||
			a == 198 && b == 51 && c == 100 || a == 203 && b == 0 && c == 113 {
			return false
		}
	} else {
		if ip.IsUnspecified() || ip.IsMulticast() {
			return false
		}
	}
	return true
}
