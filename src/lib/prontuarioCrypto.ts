const ENC_PREFIX = "enc:";

export async function deriveKey(pin: string, userId: string, clinicId: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(`prontuario:${userId}:${clinicId}`),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true, // extractable for sessionStorage caching
    ["encrypt", "decrypt"]
  );
}

export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

export async function importKey(b64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function encryptField(value: string | null | undefined, key: CryptoKey): Promise<string | null> {
  if (value == null || value === "") return value ?? null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value)
  );
  const combined = new Uint8Array(12 + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), 12);
  return ENC_PREFIX + btoa(String.fromCharCode(...combined));
}

export async function decryptField(value: string | null | undefined, key: CryptoKey): Promise<string | null> {
  if (!value) return value ?? null;
  if (!value.startsWith(ENC_PREFIX)) return value; // dados legados em texto plano
  try {
    const combined = Uint8Array.from(atob(value.slice(ENC_PREFIX.length)), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(decrypted);
  } catch {
    return "[dados protegidos]";
  }
}

// Para campos JSONB: encripta como { _enc: "enc:..." }
export async function encryptJSON(obj: any, key: CryptoKey): Promise<any> {
  if (obj == null) return null;
  const enc = await encryptField(JSON.stringify(obj), key);
  return { _enc: enc };
}

// Suporta tanto arrays legados quanto { _enc: "..." }
export async function decryptJSON<T>(value: any, key: CryptoKey): Promise<T | null> {
  if (!value) return null;
  if (Array.isArray(value)) return value as T; // array legado sem criptografia
  if (value._enc) {
    const plain = await decryptField(value._enc, key);
    if (!plain) return null;
    try { return JSON.parse(plain) as T; } catch { return null; }
  }
  return value as T;
}
