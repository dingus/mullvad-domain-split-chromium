package main

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"
)

func TestPublicIPFilter(t *testing.T) {
	cases := map[string]bool{
		"1.1.1.1": true, "8.8.8.8": true, "9.9.9.9": true,
		"127.0.0.1": false, "10.0.0.1": false, "192.168.0.1": false,
		"172.16.0.1": false, "100.64.0.1": false, "169.254.0.1": false,
		"192.0.2.1": false, "198.51.100.1": false, "203.0.113.1": false,
		"198.18.0.1": false, "224.0.0.1": false, "::1": false, "fe80::1": false,
		"fd00::1": false, "2001:4860:4860::8888": true,
	}
	for input, expected := range cases {
		if actual := isPublic(net.ParseIP(input)); actual != expected {
			t.Errorf("isPublic(%s)=%v wanted %v", input, actual, expected)
		}
	}
}

func TestResolveHostFallsBackAfterSystemDNSFailure(t *testing.T) {
	oldSystem, oldEncrypted := systemLookupIPAddr, encryptedLookupIPAddr
	defer func() {
		systemLookupIPAddr, encryptedLookupIPAddr = oldSystem, oldEncrypted
	}()
	systemLookupIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
		return nil, errors.New("system resolver unavailable")
	}
	encryptedLookupIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("104.21.69.242")}}, nil
	}

	addresses, err := resolveHost(context.Background(), "basetao.com")
	if err != nil {
		t.Fatal(err)
	}
	if len(addresses) != 1 || addresses[0].IP.String() != "104.21.69.242" {
		t.Fatalf("unexpected fallback result: %#v", addresses)
	}
}

func TestDecodeDoHResponse(t *testing.T) {
	input := `{"Status":0,"Answer":[{"type":5,"data":"example.test."},{"type":1,"data":"104.21.69.242"},{"type":28,"data":"2606:4700:3030::6815:45f2"}]}`
	addresses, err := decodeDoHResponse(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	if len(addresses) != 2 {
		t.Fatalf("got %d addresses, wanted 2", len(addresses))
	}
	if got := addresses[0].IP.String(); got != "104.21.69.242" {
		t.Fatalf("first address = %s", got)
	}
	if got := addresses[1].IP.String(); got != "2606:4700:3030::6815:45f2" {
		t.Fatalf("second address = %s", got)
	}
}

func TestDecodeDoHResponseErrors(t *testing.T) {
	if _, err := decodeDoHResponse(strings.NewReader(`{"Status":3}`)); err == nil {
		t.Fatal("expected a DNS status error")
	}
	if _, err := decodeDoHResponse(strings.NewReader(`not-json`)); err == nil {
		t.Fatal("expected a JSON error")
	}
}
