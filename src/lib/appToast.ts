/**
 * A toast from anywhere (a screen that may be gone or showing something
 * else): AuthenticatedApp shows it with its own toast. First use: a chat
 * message that could not be kept on this phone (Claude review #291 round 8).
 */
export const APP_TOAST_EVENT = 'bw:toast';

export interface AppToast {
  message: string;
  type: 'success' | 'error' | 'info';
}

export function showAppToast(message: string, type: AppToast['type'] = 'info'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AppToast>(APP_TOAST_EVENT, { detail: { message, type } }));
}
