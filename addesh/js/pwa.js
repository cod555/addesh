// Registers the service worker so the app installs to the home screen and works offline.
export function registerServiceWorker() {
  try {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    if (!('serviceWorker' in navigator) || (location.protocol !== 'https:' && !local)) return;
    const register = () => {
      try {
        navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered:', err));
      } catch (err) {
        console.warn('Service worker not available here:', err);
      }
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  } catch {
    /* some embedded browsers block service workers entirely; the app works without one */
  }
}
