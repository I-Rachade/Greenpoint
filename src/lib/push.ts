import { isNativeApp } from "./native";

// Push notifications in the app (planung/fahrer.md phase 2). Firebase needs
// android/app/google-services.json; without it registering crashes the Android app,
// so the build turns push on with NEXT_PUBLIC_PUSH=1 (docs/DEPLOYMENT.md).

const KEY = "gp.pushToken";

export function pushEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PUSH === "1" && isNativeApp();
}

/** The token this phone registered, kept so signing out can remove it. */
export function storedPushToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function storePushToken(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode: the token is registered again on the next start.
  }
}
