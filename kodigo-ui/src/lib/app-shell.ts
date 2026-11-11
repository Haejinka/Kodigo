import type { OfflineQueuedOperation } from '@/types/offline'
import { OFFLINE_DATABASE_VERSION, openOfflineDatabase } from './offline-db'

const SUPPORTED_OPERATION_CONTRACTS = new Set([1])
const SUPPORTED_QUEUE_STATES = new Set([
  'local_pending', 'syncing', 'synchronized', 'retry_wait', 'conflicted', 'blocked_auth', 'needs_recovery',
])

export interface AppShellUpdateNotice {
  registration: ServiceWorkerRegistration
  compatible: boolean
  reason?: string
  multipleTabs?: boolean
}

export type AppShellUpdateListener = (notice: AppShellUpdateNotice | null) => void

/** Register the static shell and expose updates only after durable offline data is checked. */
export function watchCompatibleAppShellUpdates(listener: AppShellUpdateListener): () => void {
  if (typeof navigator === 'undefined' || typeof window === 'undefined'
    || !('serviceWorker' in navigator) || !window.isSecureContext) {
    return () => undefined
  }

  let disposed = false
  let registration: ServiceWorkerRegistration | null = null
  const hadController = Boolean(navigator.serviceWorker.controller)

  const inspectWaitingWorker = async (): Promise<void> => {
    if (disposed || !registration?.waiting) return
    const compatible = await inspectOfflineDataCompatibility()
    if (!disposed && registration?.waiting) {
      listener({ registration, compatible: compatible.ok, reason: compatible.reason })
    }
  }

  const onControllerChange = (): void => {
    if (hadController) window.location.reload()
  }
  const onWorkerMessage = (event: MessageEvent): void => {
    if (event.data?.type === 'UPDATE_BLOCKED_MULTIPLE_TABS' && registration) {
      listener({ registration, compatible: true, multipleTabs: true })
    }
  }
  const watchInstallingWorker = (activeRegistration: ServiceWorkerRegistration): void => {
    const installing = activeRegistration.installing
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        void inspectWaitingWorker()
      } else if (installing.state === 'redundant' && navigator.serviceWorker.controller) {
        void inspectOfflineDataCompatibility().then((compatibility) => {
          if (!disposed && !compatibility.ok) {
            listener({ registration: activeRegistration, compatible: false, reason: compatibility.reason })
          }
        })
      }
    })
  }

  void navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).then(async (nextRegistration) => {
    if (disposed) return
    registration = nextRegistration
    nextRegistration.addEventListener('updatefound', () => watchInstallingWorker(nextRegistration))
    watchInstallingWorker(nextRegistration)
    navigator.serviceWorker.addEventListener('message', onWorkerMessage)
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (nextRegistration.waiting) await inspectWaitingWorker()
    else if (document.visibilityState === 'visible') void nextRegistration.update()
  }).catch(() => {
    // The application remains online-capable when browser storage or service workers are unavailable.
  })

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') void registration?.update()
  }

  return () => {
    disposed = true
    navigator.serviceWorker.removeEventListener('message', onWorkerMessage)
    navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

/** Recheck immediately before activation; do not activate a bundle that cannot read saved work. */
export async function activateCompatibleAppShellUpdate(registration: ServiceWorkerRegistration): Promise<boolean> {
  const worker = registration.waiting
  if (!worker) return false
  const compatibility = await inspectOfflineDataCompatibility()
  if (!compatibility.ok) return false
  worker.postMessage({
    type: 'ACTIVATE_COMPATIBLE_UPDATE',
    databaseVersion: OFFLINE_DATABASE_VERSION,
    operationContracts: [...SUPPORTED_OPERATION_CONTRACTS],
  })
  return true
}

export async function inspectOfflineDataCompatibility(): Promise<{ ok: boolean; reason?: string }> {
  let database: Awaited<ReturnType<typeof openOfflineDatabase>> | undefined
  try {
    database = await openOfflineDatabase()
    if (database.version !== OFFLINE_DATABASE_VERSION) {
      return { ok: false, reason: 'This device’s offline database needs recovery before the update can be applied.' }
    }

    const [operations, leases, metadata] = await Promise.all([
      database.getAll('operations_outbox'),
      database.getAll('offline_leases'),
      database.getAll('terminal_meta'),
    ])
    if (!operations.every(isSupportedQueuedOperation)) {
      return { ok: false, reason: 'An offline operation uses a command version this update cannot safely read.' }
    }
    if (!leases.every((lease) => isRecord(lease) && isEncryptedLeaseRecord(lease))) {
      return { ok: false, reason: 'Offline authorization data needs recovery before this update can be applied.' }
    }
    if (!metadata.every((record) => isRecord(record)
      && isRecord(record.wrapped_master_key)
      && record.wrapped_master_key.schema_version === 2
      && record.wrapped_master_key.version === 1)) {
      return { ok: false, reason: 'This device’s offline key format is not supported by the update.' }
    }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'Offline storage could not be checked, so the update is paused.' }
  } finally {
    database?.close()
  }
}

function isSupportedQueuedOperation(value: OfflineQueuedOperation): boolean {
  if (!isRecord(value)) return false
  const contractVersion = (value as OfflineQueuedOperation & { contract_version?: unknown }).contract_version ?? 1
  return typeof contractVersion === 'number'
    && SUPPORTED_OPERATION_CONTRACTS.has(contractVersion)
    && typeof value.operation_id === 'string'
    && typeof value.operation_kind === 'string'
    && typeof value.payload_hash === 'string'
    && /^[0-9a-f]{64}$/i.test(value.payload_hash)
    && Number.isSafeInteger(value.terminal_sequence)
    && value.terminal_sequence > 0
    && SUPPORTED_QUEUE_STATES.has(value.state)
    && isRecord(value.encrypted_payload)
    && value.encrypted_payload.version === 1
    && typeof value.encrypted_payload.iv === 'string'
    && typeof value.encrypted_payload.ciphertext === 'string'
}

function isEncryptedLeaseRecord(value: Record<string, unknown>): boolean {
  const encrypted = value.encrypted_snapshot
  return isRecord(encrypted) && encrypted.version === 1
    && typeof encrypted.iv === 'string' && encrypted.iv.length > 0
    && typeof encrypted.ciphertext === 'string' && encrypted.ciphertext.length > 0
    && !('expires_at' in value) && !('sequence_start' in value) && !('sequence_end' in value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
