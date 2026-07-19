export const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  'https://katarik-5g25.onrender.com',
  'https://localhost',
  'capacitor://localhost',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
]);

function normalizeOrigin(origin) {
  return String(origin || '').trim().replace(/\/$/, '').toLowerCase();
}

export function parseAllowedOrigins(value, fallback = DEFAULT_ALLOWED_ORIGINS) {
  const origins = value
    ? value.split(',').map(normalizeOrigin).filter(Boolean)
    : fallback.map(normalizeOrigin);

  return new Set(origins);
}

export function createOriginPolicy(allowedOrigins) {
  return function isOriginAllowed(origin) {
    // Non-browser clients do not send Origin and cannot perform a browser CORS attack.
    if (!origin) return true;
    return allowedOrigins.has(normalizeOrigin(origin));
  };
}
