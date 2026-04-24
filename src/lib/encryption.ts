
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return await window.crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey("spki", key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

export async function importPublicKey(base64: string): Promise<CryptoKey> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return await window.crypto.subtle.importKey(
    "spki",
    bytes,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["encrypt"]
  );
}

export async function encryptMessage(text: string, publicKey: CryptoKey): Promise<string> {
  // 1. Generate a symmetric AES key
  const aesKey = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"]
  );

  // 2. Encrypt the message with AES
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encryptedContent = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    encoder.encode(text)
  );

  // 3. Encrypt the AES key with RSA Public Key
  const exportedAesKey = await window.crypto.subtle.exportKey("raw", aesKey);
  const encryptedAesKey = await window.crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    exportedAesKey
  );

  // 4. Combine and encode
  const result = {
    content: btoa(String.fromCharCode(...new Uint8Array(encryptedContent))),
    key: btoa(String.fromCharCode(...new Uint8Array(encryptedAesKey))),
    iv: btoa(String.fromCharCode(...new Uint8Array(iv)))
  };

  return JSON.stringify(result);
}

export async function decryptMessage(encryptedJson: string, privateKey: CryptoKey): Promise<string> {
  const { content, key, iv } = JSON.parse(encryptedJson);

  // 1. Decrypt the AES key with RSA Private Key
  const encryptedAesKeyBytes = new Uint8Array(atob(key).split("").map(c => c.charCodeAt(0)));
  const exportedAesKey = await window.crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    encryptedAesKeyBytes
  );

  // 2. Import the AES key
  const aesKey = await window.crypto.subtle.importKey(
    "raw",
    exportedAesKey,
    { name: "AES-GCM" },
    true,
    ["decrypt"]
  );

  // 3. Decrypt the content with AES
  const ivBytes = new Uint8Array(atob(iv).split("").map(c => c.charCodeAt(0)));
  const contentBytes = new Uint8Array(atob(content).split("").map(c => c.charCodeAt(0)));
  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes },
    aesKey,
    contentBytes
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}
