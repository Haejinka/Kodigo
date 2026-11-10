import { canonicalOperationJson } from './pos-operations.ts';
import type {
  EncryptedOfflinePayload,
  OfflineRecordScope,
  WrappedOfflineMasterKey,
} from '@/types/offline';

const AES_GCM_KEY_LENGTH = 256;
const AES_GCM_IV_LENGTH = 12;
const PBKDF2_SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 600_000;
const AAD_SCHEMA_VERSION = 2;

export interface OfflineMasterKeyMaterial {
  key: CryptoKey;
  wrapped: WrappedOfflineMasterKey;
}

export class OfflineKeySession {
  private key: CryptoKey | null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleTimeoutMs: number;
  private readonly onLock?: () => void;

  constructor(key: CryptoKey, idleTimeoutMs: number, onLock?: () => void) {
    if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) {
      throw new TypeError('An approved positive idle-lock duration is required.');
    }
    this.key = key;
    this.idleTimeoutMs = idleTimeoutMs;
    this.onLock = onLock;
    this.refreshIdleLock();
  }

  getKey(): CryptoKey {
    if (!this.key) throw new Error('Offline data is locked. Unlock it before continuing.');
    this.refreshIdleLock();
    return this.key;
  }

  get isUnlocked(): boolean {
    return this.key !== null;
  }

  lock(): void {
    if (!this.key) return;
    this.key = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.onLock?.();
  }

  private refreshIdleLock(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.lock(), this.idleTimeoutMs);
  }
}

export async function createOfflineMasterKey(
  passphrase: string,
  scope: Omit<OfflineRecordScope, 'recordId'>,
): Promise<OfflineMasterKeyMaterial> {
  assertPassphrase(passphrase);
  assertScope(scope);
  const salt = randomBytes(PBKDF2_SALT_LENGTH);
  const iv = randomBytes(AES_GCM_IV_LENGTH);
  const wrappingKey = await deriveWrappingKey(passphrase, salt);
  const extractableMaster = await cryptoApi().subtle.generateKey(
    { name: 'AES-GCM', length: AES_GCM_KEY_LENGTH },
    true,
    ['encrypt', 'decrypt'],
  );
  const rawMaster = new Uint8Array(await cryptoApi().subtle.exportKey('raw', extractableMaster));
  const rawMasterBuffer = toArrayBuffer(rawMaster);

  try {
    const wrappedBytes = await cryptoApi().subtle.encrypt({
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(masterKeyAad(scope)),
      tagLength: 128,
    }, wrappingKey, rawMasterBuffer);
    const key = await cryptoApi().subtle.importKey(
      'raw',
      rawMasterBuffer,
      { name: 'AES-GCM', length: AES_GCM_KEY_LENGTH },
      false,
      ['encrypt', 'decrypt'],
    );
    return {
      key,
      wrapped: {
        version: 1,
        schema_version: AAD_SCHEMA_VERSION,
        kdf: 'PBKDF2-SHA256',
        iterations: PBKDF2_ITERATIONS,
        store_id: scope.storeId,
        actor_id: scope.actorId,
        terminal_id: scope.terminalId,
        salt: toBase64(salt),
        iv: toBase64(iv),
        ciphertext: toBase64(new Uint8Array(wrappedBytes)),
      },
    };
  } finally {
    rawMaster.fill(0);
    new Uint8Array(rawMasterBuffer).fill(0);
  }
}

export async function unlockOfflineMasterKey(
  passphrase: string,
  wrapped: WrappedOfflineMasterKey,
  scope: Omit<OfflineRecordScope, 'recordId'>,
): Promise<CryptoKey> {
  assertPassphrase(passphrase);
  assertScope(scope);
  if (wrapped.version !== 1 || wrapped.schema_version !== AAD_SCHEMA_VERSION
    || wrapped.kdf !== 'PBKDF2-SHA256' || wrapped.iterations !== PBKDF2_ITERATIONS
    || wrapped.store_id !== scope.storeId || wrapped.actor_id !== scope.actorId
    || wrapped.terminal_id !== scope.terminalId) {
    throw new Error('Offline key envelope is incompatible with this account, terminal, or application version.');
  }

  const salt = fromBase64(wrapped.salt);
  const iv = fromBase64(wrapped.iv);
  if (salt.byteLength !== PBKDF2_SALT_LENGTH || iv.byteLength !== AES_GCM_IV_LENGTH) {
    throw new Error('Offline key envelope is invalid.');
  }
  const wrappingKey = await deriveWrappingKey(passphrase, salt);
  let rawMaster: Uint8Array | null = null;
  let rawMasterBuffer: ArrayBuffer | null = null;
  try {
    const decrypted = await cryptoApi().subtle.decrypt({
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(masterKeyAad(scope)),
      tagLength: 128,
    }, wrappingKey, toArrayBuffer(fromBase64(wrapped.ciphertext)));
    rawMaster = new Uint8Array(decrypted);
    if (rawMaster.byteLength !== AES_GCM_KEY_LENGTH / 8) throw new Error('Invalid key length.');
    rawMasterBuffer = toArrayBuffer(rawMaster);
    return await cryptoApi().subtle.importKey(
      'raw',
      rawMasterBuffer,
      { name: 'AES-GCM', length: AES_GCM_KEY_LENGTH },
      false,
      ['encrypt', 'decrypt'],
    );
  } catch {
    throw new Error('Unable to unlock offline data. Check the passphrase and recovery scope.');
  } finally {
    rawMaster?.fill(0);
    if (rawMasterBuffer) new Uint8Array(rawMasterBuffer).fill(0);
  }
}

export async function encryptOfflinePayload(
  value: unknown,
  key: CryptoKey,
  scope: OfflineRecordScope,
): Promise<EncryptedOfflinePayload> {
  assertScope(scope);
  const iv = randomBytes(AES_GCM_IV_LENGTH);
  const plaintext = new TextEncoder().encode(canonicalOperationJson(value));
  const plaintextBuffer = toArrayBuffer(plaintext);
  try {
    const ciphertext = await cryptoApi().subtle.encrypt({
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(recordAad(scope)),
      tagLength: 128,
    }, key, plaintextBuffer);
    return { version: 1, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
  } finally {
    plaintext.fill(0);
    new Uint8Array(plaintextBuffer).fill(0);
  }
}

export async function decryptOfflinePayload<T>(
  envelope: EncryptedOfflinePayload,
  key: CryptoKey,
  scope: OfflineRecordScope,
): Promise<T> {
  assertScope(scope);
  if (envelope.version !== 1) throw new Error('Unsupported encrypted offline record version.');
  const iv = fromBase64(envelope.iv);
  if (iv.byteLength !== AES_GCM_IV_LENGTH) throw new Error('Encrypted offline record is invalid.');
  let plaintext: Uint8Array | null = null;
  try {
    const decrypted = await cryptoApi().subtle.decrypt({
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(recordAad(scope)),
      tagLength: 128,
    }, key, toArrayBuffer(fromBase64(envelope.ciphertext)));
    plaintext = new Uint8Array(decrypted);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)) as T;
  } catch {
    throw new Error('Encrypted offline record could not be authenticated or decoded.');
  } finally {
    plaintext?.fill(0);
  }
}

function assertPassphrase(passphrase: string): void {
  if (typeof passphrase !== 'string' || passphrase.length === 0) throw new Error('An offline unlock passphrase is required.');
}

function assertScope(scope: Pick<OfflineRecordScope, 'storeId' | 'actorId' | 'terminalId'>): void {
  if (!scope.storeId || !scope.actorId || !scope.terminalId) throw new Error('Offline encryption requires a complete store, actor, and terminal scope.');
}

function cryptoApi(): Crypto {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
    throw new Error('Web Crypto is unavailable; offline payloads were not stored.');
  }
  return globalThis.crypto;
}

function randomBytes(length: number): Uint8Array {
  return cryptoApi().getRandomValues(new Uint8Array(length));
}

async function deriveWrappingKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const passphraseBytes = new TextEncoder().encode(passphrase);
  const passphraseBuffer = toArrayBuffer(passphraseBytes);
  try {
    const material = await cryptoApi().subtle.importKey(
      'raw', passphraseBuffer, 'PBKDF2', false, ['deriveKey'],
    );
    return await cryptoApi().subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations: PBKDF2_ITERATIONS },
      material, { name: 'AES-GCM', length: AES_GCM_KEY_LENGTH }, false, ['encrypt', 'decrypt']);
  } finally {
    passphraseBytes.fill(0);
    new Uint8Array(passphraseBuffer).fill(0);
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function masterKeyAad(scope: Omit<OfflineRecordScope, 'recordId'>): Uint8Array {
  return new TextEncoder().encode(canonicalOperationJson({
    purpose: 'offline-master-key-wrap', schema_version: AAD_SCHEMA_VERSION, ...scope,
  }));
}

function recordAad(scope: OfflineRecordScope): Uint8Array {
  return new TextEncoder().encode(canonicalOperationJson({
    purpose: 'offline-payload', schema_version: AAD_SCHEMA_VERSION, ...scope,
  }));
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    throw new Error('Encrypted offline record is invalid.');
  }
}
