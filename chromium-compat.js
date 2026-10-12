/** Chromium API adapters for the unmodified Firefox-derived UI bundles. */
(() => {
  'use strict';
  if (!globalThis.chrome?.runtime?.id) return;
  const c = chrome;
  const action = c.action;
  const browserAction = Object.create(action);
  if (typeof action.setBadgeTextColor !== 'function') browserAction.setBadgeTextColor = async () => {};

  // Chrome exposes policy controls for WebRTC IP leaks, rather than Firefox's
  // peerConnectionEnabled setting. This is a best-effort protection setting.
  const rtcPolicy = c.privacy?.network?.webRTCIPHandlingPolicy;
  const peerConnectionEnabled = {
    async get() {
      if (!rtcPolicy) return {value: true};
      const result = await rtcPolicy.get({});
      return {value: result?.value !== 'disable_non_proxied_udp'};
    },
    async set({value}) {
      if (!rtcPolicy) return;
      await rtcPolicy.set({value: value ? 'default' : 'disable_non_proxied_udp'});
    }
  };
  const privacy = {
    ...c.privacy,
    network: {
      ...c.privacy?.network,
      peerConnectionEnabled,
      // Chromium cannot read Chrome's "Always use secure connections" setting.
      // Report 'never' so the existing UI NEVER claims the setting is enabled.
      httpsOnlyMode: {async get() { return {value:'never'}; }}
    }
  };
  const extension = {
    ...(c.extension || {}),
    getViews: (filter) => {
      if (typeof c.extension?.getViews === 'function') return c.extension.getViews(filter);
      return typeof window !== 'undefined' && /\/dist\/popup\//.test(location.pathname) ? [window] : [];
    }
  };
  // Chromium has no search.get() listing all installed search providers.
  // Use a conservative value: don't claim a privacy-friendly default.
  const search = {async get() { return [{name:'Google (not verified)',isDefault:true}]; }};
  globalThis.browser = new Proxy(c, {
    get(target, property) {
      if (property === 'browserAction') return browserAction;
      if (property === 'privacy') return privacy;
      if (property === 'extension') return extension;
      if (property === 'search') return search;
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
})();
