/**
 * Chromium MV3 proxy engine for Mullvad Browser Extension v0.9.10.
 * Original Firefox listener `browser.proxy.onRequest` is replaced by a PAC
 * script, refreshed from storage. PAC rules work by URL/hostname, not tab ID.
 *
 * NOTE: chrome.proxy affects the whole browser profile. Disabling a domain
 * preference cannot isolate the proxy to just one tab.
 */
'use strict';
const CONFIG_KEYS = new Set([
  'excludedHosts','globalProxy','globalProxyDetails','hostProxies',
  'hostProxiesDetails','randomProxyMode','flatProxiesList',
  'homeRoutingEnabled','homeDefault','homeDomains','vpnDomains'
]);
let debounce;
// PAC logic reuses this lexical binding for the extension badge; never eval JS in an MV3 worker.
let PROXY_SETTINGS = {};
const parse = (v, fallback) => {
  if (v === undefined || v === null) return fallback;
  try { return typeof v === 'string' ? JSON.parse(v) : v; }
  catch { return fallback; }
};
const validHost = (s) => typeof s === 'string' && /^[a-z0-9.:_-]+$/i.test(s) && s.length < 254;
const validateServer = (proxy) => {
  if (!proxy || proxy.type === 'direct') return null;
  const host = proxy.host;
  const port = Number(proxy.port ?? 1080);
  if (!validHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  // Firefox's "socks" is SOCKS5 in Chromium; remote DNS is supported by SOCKS5.
  const proto = proxy.type === 'http' ? 'PROXY' : proxy.type === 'https' ? 'HTTPS' :
    proxy.type === 'socks4' ? 'SOCKS' : 'SOCKS5';
  return `${proto} ${host}:${port}`;
};
function stateFromStorage(data) {
  return {
    excluded: parse(data.excludedHosts, []),
    global: parse(data.globalProxy, {}),
    globalDetails: parse(data.globalProxyDetails, {}),
    hosts: parse(data.hostProxies, {}),
    hostDetails: parse(data.hostProxiesDetails, {}),
    random: parse(data.randomProxyMode, false),
    proxies: parse(data.flatProxiesList, []),
    homeEnabled: data.homeRoutingEnabled === true,
    homeDefault: data.homeDefault === true,
    homeDomains: parse(data.homeDomains, []),
    vpnDomains: parse(data.vpnDomains, [])
  };
}
function validDomainList(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(x => typeof x === 'string' && x.length <= 253 &&
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(x)).map(x => x.toLowerCase()))];
}
function compiledState(state) {
  const hosts = {};
  for (const [name, proxy] of Object.entries(state.hosts || {})) {
    if (state.hostDetails?.[name]?.socksEnabled && /^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/i.test(name)) {
      const directive = validateServer(proxy);
      if (directive) hosts[name.toLowerCase()] = directive;
    }
  }
  const random = (Array.isArray(state.proxies) ? state.proxies : [])
    .map(p => validateServer({type:'socks',host:p.ipv4_address || '10.64.0.1',port:p.port || 1080}))
    .filter(Boolean);
  return {
    excluded: (Array.isArray(state.excluded) ? state.excluded : []).filter(s => typeof s === 'string').map(s => s.toLowerCase()),
    hosts,
    global: state.globalDetails?.socksEnabled ? validateServer(state.global) : null,
    random: !!state.random,
    randomServers: random,
    homeEnabled: state.homeEnabled,
    homeDefault: state.homeDefault,
    homeDomains: validDomainList(state.homeDomains),
    vpnDomains: validDomainList(state.vpnDomains),
    homeDirective: 'SOCKS5 127.0.0.1:37651'
  };
}
/** This is self-contained ES5 JavaScript, to be serialized into a PAC script. */
function FindProxyForURL(url, host) {
  host = (host || '').toLowerCase().replace(/\.$/, '');
  // Never proxy local names or reserved addresses.
  if (!host || host === 'localhost' || host.slice(-10) === '.localhost' || host.indexOf('.') < 0 ||
      /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) || /^0\./.test(host) || /^224\./.test(host) ||
      /^255\./.test(host) || host === '::1' || /^f[cd][0-9a-f]*:/.test(host) ||
      /^fe[89ab][0-9a-f]*:/.test(host)) return 'DIRECT';
  var parts = host.split('.');
  if (parts.length === 4 && parts.every(function(p){return /^\d+$/.test(p);})) {
    var a=+parts[0],b=+parts[1];
    if ((a===172&&b>=16&&b<=31)||(a===100&&b>=64&&b<=127)||
        (a===192&&b===0)||(a===198&&(b===18||b===19))||a>=224) return 'DIRECT';
  }
  var cfg = PROXY_SETTINGS;
  // Explicit home/VPN routing rules override original extension settings.
  if (cfg.homeEnabled) {
    for (var h=0; h<cfg.homeDomains.length; h++) {
      var d=cfg.homeDomains[h];
      if (host===d || host.slice(-(d.length+1))==='.'+d) return cfg.homeDirective;
    }
    for (var v=0; v<cfg.vpnDomains.length; v++) {
      var d2=cfg.vpnDomains[v];
      if (host===d2 || host.slice(-(d2.length+1))==='.'+d2) return 'DIRECT';
    }
  }
  // Original named exclusions mean no browser proxy (still within OS VPN).
  for (var i=0; i<cfg.excluded.length; i++) {
    var excluded=cfg.excluded[i];
    if (host===excluded || host.slice(-(excluded.length+1))==='.'+excluded) return 'DIRECT';
  }
  // Choose the most specific explicit Mullvad SOCKS5 rule before defaults.
  for(var k=0; k<parts.length; k++) {
    var suffix=parts.slice(k).join('.');
    if (Object.prototype.hasOwnProperty.call(cfg.hosts,suffix)) return cfg.hosts[suffix];
  }
  // With home-default on, the helper wins over the original global/random rules.
  if (cfg.homeEnabled && cfg.homeDefault) return cfg.homeDirective;
  if (cfg.random && cfg.randomServers.length) {
    var n=0;
    for (var j=0; j<host.length; j++) n = ((n*31+host.charCodeAt(j))>>>0);
    return cfg.randomServers[n%cfg.randomServers.length];
  }
  return cfg.global || 'DIRECT';
}
function pacFor(compiled) {
  return `var PROXY_SETTINGS = ${JSON.stringify(compiled)};\n${FindProxyForURL.toString()}`;
}
async function applyProxy() {
  try {
    const state = stateFromStorage(await chrome.storage.local.get([...CONFIG_KEYS]));
    const compiled = compiledState(state);
    const enabled = !!compiled.global || Object.keys(compiled.hosts).length > 0 ||
      (compiled.random && compiled.randomServers.length > 0) ||
      (compiled.homeEnabled && (compiled.homeDefault || compiled.homeDomains.length > 0));
    if (!enabled) {
      await chrome.proxy.settings.clear({scope:'regular'});
    } else {
      await chrome.proxy.settings.set({value:{mode:'pac_script',pacScript:{data:pacFor(compiled),mandatory:true}},scope:'regular'});
    }
    await refreshBadge();
  } catch(err) {
    console.error('[Mullvad Chromium Port] Cannot apply proxy configuration:',err);
    await chrome.action.setBadgeText({text:'!'}).catch(()=>{});
    await chrome.action.setBadgeBackgroundColor({color:'#D13D39'}).catch(()=>{});
    await chrome.action.setTitle({title:'Mullvad proxy error — inspect extension service worker'}).catch(()=>{});
  }
}
function routeForHost(name,compiled) {
  if (!name) return false;
  try {
    const host = new URL(name).hostname;
    PROXY_SETTINGS = compiled;
    const result = FindProxyForURL(name,host);
    return result.startsWith('SOCKS5 127.0.0.1:37651') ? 'HOME' : result === 'DIRECT' ? 'DIRECT' : 'MULLVAD';
  } catch {return 'DIRECT';}
}
async function refreshBadge(tab) {
  try {
    if (!tab) [tab] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
    if (!tab?.id || !tab.url) return;
    if (!/^https?:/i.test(tab.url)) {
      await chrome.action.setBadgeText({tabId:tab.id,text:''});
      return;
    }
    const cfg = compiledState(stateFromStorage(await chrome.storage.local.get([...CONFIG_KEYS])));
    const route = routeForHost(tab.url,cfg);
    const badge = route === 'HOME' ? 'H' : route === 'MULLVAD' ? 'M' : '';
    await chrome.action.setBadgeText({tabId:tab.id,text:badge});
    if (badge) await chrome.action.setBadgeBackgroundColor({tabId:tab.id,color:route === 'HOME' ? '#65d48a' : '#ffd524'});
    await chrome.action.setTitle({tabId:tab.id,title:route === 'HOME' ? 'Home-IP helper route (verify the helper is excluded from Mullvad)' : route === 'MULLVAD' ? 'Mullvad SOCKS5 proxy route' : 'No browser proxy (follows Windows/Mullvad VPN network route)'});
  } catch(err) {console.warn('[Mullvad Chromium Port] Badge update:',err);}
}
function scheduleApply() {
  clearTimeout(debounce);
  debounce = setTimeout(()=>{void applyProxy()},100);
}
chrome.runtime.onInstalled.addListener(()=>{void applyProxy()});
chrome.runtime.onStartup.addListener(()=>{void applyProxy()});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area === 'local' && Object.keys(changes).some(k=>CONFIG_KEYS.has(k))) scheduleApply();
});
chrome.tabs.onActivated.addListener(({tabId})=>{chrome.tabs.get(tabId).then(refreshBadge).catch(()=>{});});
chrome.tabs.onUpdated.addListener((id,change,tab)=>{if(change.url||change.status==='complete') void refreshBadge(tab);});
chrome.proxy.onProxyError.addListener(e=>{console.error('[Mullvad Chromium Port] Proxy error:',e);});
// Ensure settings survive MV3 service worker suspension/restart.
void applyProxy();
