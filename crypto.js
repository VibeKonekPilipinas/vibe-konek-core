
// crypto.js
// Content encryption on top of WebRTC's transport security.
// We use ECDH (P-256) to derive an AES-GCM key per session.
// MDN SubtleCrypto supports deriveKey/deriveBits for ECDH/X25519; here we use P-256 for wide browser support.
// Ref: MDN deriveKey, WebCrypto examples. 
// NOTE: Works only on HTTPS origins or localhost secure contexts.

export const E2EE = (() => {
  async function generateKeyPair() {
    return crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
  }

  async function exportPub(keyPair) {
    return crypto.subtle.exportKey('jwk', keyPair.publicKey);
  }

  async function importPub(jwk) {
    return crypto.subtle.importKey(
      'jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []
    );
  }

  async function deriveAesGcmKey(privateKey, peerPublicKey) {
    return crypto.subtle.deriveKey(
      { name: 'ECDH', public: peerPublicKey },
      privateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encrypt(aesKey, text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      new TextEncoder().encode(text)
    );
    return { iv: Array.from(iv), data: Array.from(new Uint8Array(cipher)) };
  }

  async function decrypt(aesKey, payload) {
    const iv = new Uint8Array(payload.iv);
    const data = new Uint8Array(payload.data);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, data);
    return new TextDecoder().decode(plain);
  }

  return { generateKeyPair, exportPub, importPub, deriveAesGcmKey, encrypt, decrypt };
})();
