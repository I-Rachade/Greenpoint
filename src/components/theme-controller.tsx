"use client";

import { useEffect } from "react";
import { useTheme } from "@/lib/prefs";

/** Runs before React loads (in <head>) so a dark-mode user never sees a white flash. */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("poinderecharge-theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

/** Keeps the "dark" class on <html> in line with the setting and, for "system", the phone. */
export function ThemeController() {
  const [theme] = useTheme();

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  return null;
}
