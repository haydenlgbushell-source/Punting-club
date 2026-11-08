// Phone/browser push notifications: switch on/off for this device.
import { apiPushPublicKey, apiPushSubscribe, apiPushUnsubscribe } from '../api.js';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent || '')
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

// 'unsupported' | 'ios-install' (iPhone, not added to Home Screen) | 'denied' | 'on' | 'off'
export async function pushState() {
  if (typeof window === 'undefined') return 'unsupported';
  if (isIos() && !isStandalone()) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg && await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

const toKey = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js', { scope: '/' }); }
  catch (_) { return null; }
}

// Must be called from a tap (browsers only ask for permission on a user gesture).
export async function enablePush() {
  const { publicKey } = await apiPushPublicKey();
  if (!publicKey) throw new Error('Notifications are not set up on the server yet.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them in your phone settings to switch on.');
  const reg = (await registerServiceWorker()) || (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) });
  await apiPushSubscribe(sub.toJSON());
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg && await reg.pushManager.getSubscription();
  if (!sub) return;
  try { await apiPushUnsubscribe(sub.endpoint); } catch (_) { /* still unsubscribe locally */ }
  await sub.unsubscribe();
}

// Keep the server's copy fresh (browsers occasionally rotate subscriptions).
export async function resyncPush() {
  try {
    if ((await pushState()) !== 'on') return;
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) await apiPushSubscribe(sub.toJSON());
  } catch (_) { /* best effort */ }
}
