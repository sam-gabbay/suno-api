// Runs in the page before Suno loads Turnstile. Keep the normal widget intact,
// while retaining the parameters/callback needed by the configured solver.
export function installTurnstileCapture() {
  let current;
  const wrap = (api) => {
    if (!api || typeof api.render !== 'function' || api.render.__sunoWrapped) return;
    const original = api.render;
    const wrapped = function (container, options) {
      window.__sunoTurnstile = {
        sitekey: options.sitekey,
        action: options.action,
        data: options.cData,
        pagedata: options.chlPageData,
        callback: options.callback,
      };
      return original.call(this, container, options);
    };
    wrapped.__sunoWrapped = true;
    api.render = wrapped;
  };
  Object.defineProperty(window, 'turnstile', {
    configurable: true,
    get: () => current,
    set: (api) => { current = api; wrap(api); },
  });
  const watcher = setInterval(() => wrap(current), 10);
  setTimeout(() => clearInterval(watcher), 120000);
}
