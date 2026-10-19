/**
 * Tiny scripts inlined in <head> by scripts/build.mjs: they run before the
 * first paint.
 */
export const DESIGN_KEY = "elfatina.design.v3";


/**
 * The store's remembered colours and fonts (Admin → Apparence), no flash of the defaults.
 * Every font is self-hosted (styles/fonts.css): the saved CSS only switches CSS variables.
 */
export const THEME_BOOT = `try{var d=JSON.parse(localStorage.getItem("${DESIGN_KEY}")||"null");if(d){if(d.css){var s=document.createElement("style");s.id="elfatina-theme";s.textContent=d.css;document.head.appendChild(s)}}}catch(e){}`;
