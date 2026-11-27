// Business settings shown to agents. Set them in .env (VITE_ variables are built into the web app).
export const PLAN_PRICE = import.meta.env.VITE_AGENT_PLAN_PRICE || '₹999/month';
export const TRIAL_DAYS = Number(import.meta.env.VITE_AGENT_TRIAL_DAYS || 30);
/** Quotes kept per agency (keep in sync with MAX_QUOTES_PER_AGENT on the server). */
export const MAX_QUOTES = Number(import.meta.env.VITE_MAX_QUOTES_PER_AGENT || 20);
/** Your WhatsApp number (digits) for agents to contact you about renewals. */
export const SUPPORT_WHATSAPP = import.meta.env.VITE_SUPPORT_WHATSAPP || '';
export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || '';
