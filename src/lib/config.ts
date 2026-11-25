/** Public contact address shown in the app (help, legal notice, operators). */
export const CONTACT_EMAIL = "contact@poinderecharge.com";

/**
 * Build of the back office (admin.poinderecharge.com, `npm run build:admin`). Only that build
 * has the /admin pages; the web app and the phone apps leave them out (next.config.ts).
 */
export const BACKOFFICE_BUILD = process.env.NEXT_PUBLIC_BACKOFFICE_BUILD === "1";

/** Where the back office starts: here in its own build, otherwise on its own address. */
export const ADMIN_HOME = BACKOFFICE_BUILD ? "/admin" : "https://admin.poinderecharge.com/admin";
