export async function verifyTurnstile(token, secret, ip, fetchFn = fetch) {
  if (!token || !secret) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const res = await fetchFn("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}
