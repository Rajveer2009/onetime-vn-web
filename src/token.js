export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_");
}

export const isToken = (s) => /^[A-Za-z0-9_-]{32}$/.test(s);
