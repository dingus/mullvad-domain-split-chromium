package main

import (
 "net"
 "testing"
)

func TestPublicIPFilter(t *testing.T) {
 cases := map[string]bool{
  "1.1.1.1":true,"8.8.8.8":true,"9.9.9.9":true,
  "127.0.0.1":false,"10.0.0.1":false,"192.168.0.1":false,
  "172.16.0.1":false,"100.64.0.1":false,"169.254.0.1":false,
  "192.0.2.1":false,"198.51.100.1":false,"203.0.113.1":false,
  "198.18.0.1":false,"224.0.0.1":false,"::1":false,"fe80::1":false,
  "fd00::1":false,"2001:4860:4860::8888":true,
 }
 for input, expected := range cases {
  if actual:=isPublic(net.ParseIP(input));actual!=expected {t.Errorf("isPublic(%s)=%v wanted %v",input,actual,expected)}
 }
}
