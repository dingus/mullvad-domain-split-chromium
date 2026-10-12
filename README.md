# Mullvad Domain Split for Chromium

An unofficial, experimental Chromium adaptation of Mullvad Browser Extension 0.9.10 with per-domain routing between a Mullvad VPN route and the computer's normal home-IP route.

This project is not developed, reviewed, distributed, or supported by Mullvad VPN AB.

## What it does

- Keeps Chrome, Brave, Edge, or another Chromium browser inside the Mullvad VPN tunnel.
- Sends selected hostnames through Mullvad SOCKS5 proxies or the connected Mullvad tunnel.
- Sends selected hostnames through a loopback SOCKS5 helper that Mullvad excludes from the VPN, exposing the normal ISP/home IP for those requests.
- Runs the helper silently at Windows sign-in and restarts it if its health check fails.

The routing is hostname-based and applies to the entire browser profile, not individual tabs. This is not a native per-domain VPN. Read [Security and limitations](#security-and-limitations) before relying on it.

## Requirements

- Windows 10 or 11 x64
- Mullvad VPN desktop app and an active subscription
- A Chromium browser supporting Manifest V3 and `chrome.proxy`
- PowerShell 5.1 or newer for the setup scripts

The included helper executable uses only the Go standard library. Its source and tests are in `helper/`.

## Install

1. Download or clone this repository to any temporary folder.
2. Connect the Mullvad desktop app and enable auto-connect if desired.
3. Review and run:

   ```powershell
   powershell.exe -ExecutionPolicy Bypass -File .\scripts\install.ps1
   ```

4. The installer copies the runtime to:

   ```text
   %LOCALAPPDATA%\Programs\Mullvad Domain Split
   ```

5. It adds `MullvadHomeIPHelper.exe` to Mullvad split tunneling, installs a hidden per-user startup monitor, and starts the helper.
6. In your browser, open its extensions page, enable Developer mode, select **Load unpacked**, and choose:

   ```text
   %LOCALAPPDATA%\Programs\Mullvad Domain Split
   ```

7. Open the extension and select **Domain routing: VPN vs Home IP**. Enable routing, add your hostname rules, and save.

Do not exclude the browser itself from Mullvad. Only the helper executable should be excluded.

## Routing priority

1. Localhost, LAN, and reserved/private addresses use browser `DIRECT` and remain governed by the Mullvad app.
2. **Always use Home IP** hostnames use `SOCKS5 127.0.0.1:37651`.
3. **Always use Mullvad VPN tunnel** hostnames use browser `DIRECT`, which remains inside the VPN.
4. Original extension exclusions use browser `DIRECT`, still inside the VPN.
5. Original per-domain Mullvad SOCKS5 settings.
6. Home IP default, when selected.
7. Original random/global Mullvad SOCKS5 settings, when enabled.
8. Browser `DIRECT`, still inside the VPN.

Rules match a hostname and its subdomains. Enter `example.com`, not a URL or `*.example.com`.

## Verify

Run:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\test-setup.ps1
```

The script checks the local health endpoint, Mullvad status and exclusion, and outbound connectivity through the home-IP helper. Also test intended sites in the browser. Modern pages contact many third-party hostnames, and each hostname follows its own rule.

## Build the helper

Install Go 1.23 or newer, then run:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\build-helper.ps1
```

This runs the Go tests, builds a Windows x64 executable, and prints its SHA-256 digest.

## Uninstall

From a copy of the repository outside the installed directory, run:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
```

This removes auto-start and the Mullvad exclusion but leaves installed files in place. Add `-RemoveFiles` to remove the installed runtime too. Remove the unpacked extension from your browser separately.

## Security and limitations

- The helper is intentionally bound only to `127.0.0.1`. It has no authentication, so any local process can use it while it is running.
- It permits SOCKS5 TCP `CONNECT` only, refuses UDP and BIND, rejects private/loopback/special-use destinations, and resolves hostnames inside the excluded helper process.
- If Windows DNS fails inside the excluded helper, it falls back to Cloudflare DNS over HTTPS by connecting directly to `1.1.1.1` or `1.0.0.1`. This avoids VPN-DNS reachability failures but discloses those failed hostname lookups to Cloudflare.
- Home-routed sites see the normal ISP/home IP. The helper must be excluded from Mullvad for this to work.
- PAC proxying primarily controls web requests. DNS prefetch, WebRTC, QUIC/UDP, browser background traffic, and extension traffic may behave differently. Test for IP, DNS, and WebRTC leaks.
- A page can load third-party sign-in, CDN, analytics, or media hostnames. Those hostnames follow their own rules and may use different public IPs.
- If the helper is unavailable, home-routed sites fail instead of silently falling back to another route.
- The included executable is unsigned and may produce an unknown-publisher warning. Build it from `helper/main.go` if preferred.
- The Chromium extension is unpacked and is not distributed through the Chrome Web Store.

## Project layout

- `background.js` — PAC generation, route priority, proxy control, and toolbar state
- `routing/` — domain-routing settings UI
- `dist/` and `assets/` — extension UI and static resources
- `helper/main.go` — loopback SOCKS5 home-IP helper
- `helper/main_test.go` — destination policy tests
- `tests/test_routes.js` — PAC routing tests
- `scripts/install.ps1` — portable per-user Windows installation
- `scripts/uninstall.ps1` — startup/exclusion cleanup
- `scripts/test-setup.ps1` — runtime checks
- `scripts/build-helper.ps1` — reproducible helper build

## License

GPL-3.0. See [LICENSE.md](LICENSE.md). Original Mullvad extension assets and code retain their applicable notices.

