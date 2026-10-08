import { useCallback, useState } from 'react'
import type { DeliveryPayload } from '../../shared/delivery.ts'
import { deliver, loadIntegrations, saveIntegrations, type Integration } from './integrations.ts'

export interface DeliveryStatus {
  status: 'sending' | 'sent' | 'error'
  message?: string
  auto?: boolean
}

export function useIntegrations() {
  const [integrations, setState] = useState<Integration[]>(loadIntegrations)
  const setIntegrations = useCallback((next: Integration[]) => {
    saveIntegrations(next)
    setState(next)
  }, [])
  return { integrations, setIntegrations }
}

/** Send state per integration id, for one meeting (or one test panel). */
export function useDeliveries() {
  const [statuses, setStatuses] = useState<Record<string, DeliveryStatus>>({})
  const send = useCallback(async (integration: Integration, payload: DeliveryPayload, auto = false) => {
    const set = (status: DeliveryStatus) => setStatuses((s) => ({ ...s, [integration.id]: status }))
    set({ status: 'sending', auto })
    try {
      await deliver(integration, payload)
      set({ status: 'sent', auto })
    } catch (error) {
      set({ status: 'error', auto, message: error instanceof Error ? error.message : String(error) })
    }
  }, [])
  return { statuses, send }
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}
