import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

function unavailable(message) {
  return Object.assign(new Error(message), { status: 503 });
}
export function personalAIAvailable() {
  const secret = process.env.AI_KEY_ENCRYPTION_SECRET;
  return secret
    ? Buffer.byteLength(secret) >= 32
    : process.env.NODE_ENV !== "production";
}
function masterKey(dataDirectory) {
  const secret = process.env.AI_KEY_ENCRYPTION_SECRET;
  if (secret) {
    if (Buffer.byteLength(secret) < 32)
      throw unavailable(
        "The administrator must configure an encryption secret of at least 32 characters.",
      );
    return createHash("sha256").update(secret).digest();
  }
  if (process.env.NODE_ENV === "production")
    throw unavailable(
      "Personal AI connections need an AI_KEY_ENCRYPTION_SECRET configured by the administrator.",
    );
  // Development only: retain this owner-readable file to unlock keys after restarts.
  const path = `${dataDirectory}/ai-encryption.key`;
  try {
    writeFileSync(path, randomBytes(32), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if (e.code !== "EEXIST")
      throw unavailable("Personal AI encryption storage is unavailable.");
  }
  const key = readFileSync(path);
  if (key.length !== 32)
    throw unavailable("Personal AI encryption storage is invalid.");
  return key;
}
export function encryptAIKey(key, uid, dataDirectory) {
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", masterKey(dataDirectory), nonce);
  cipher.setAAD(Buffer.from(`gpeit:openai:${uid}`));
  const encrypted = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  return [
    "v1",
    nonce.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}
export function decryptAIKey(value, uid, dataDirectory) {
  const key = masterKey(dataDirectory);
  try {
    const [version, nonce, tag, encrypted] = value.split(":");
    if (version !== "v1") throw new Error("Unsupported ciphertext");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(nonce, "base64"),
    );
    decipher.setAAD(Buffer.from(`gpeit:openai:${uid}`));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw unavailable(
      "Your personal AI key cannot be unlocked. Replace the connection, or ask the administrator to restore the original encryption secret.",
    );
  }
}
