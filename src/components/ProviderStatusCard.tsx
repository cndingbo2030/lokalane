import { CheckCircle2, CircleAlert, Clock3, DatabaseZap, KeyRound } from 'lucide-react'
import type { ProviderHealth } from '../services/providerHealth'

interface ProviderStatusCardProps {
  health: ProviderHealth
}

export function ProviderStatusCard({ health }: ProviderStatusCardProps) {
  const isReady = health.status === 'ready'
  const oneMapDetail = getOneMapDetail(health)

  return (
    <section className={`provider-health ${health.status}`} aria-label="Official data gateway">
      <div className="provider-health-heading">
        <span className="provider-health-icon">
          {isReady ? <DatabaseZap size={16} /> : <CircleAlert size={16} />}
        </span>
        <div>
          <strong>Official data gateway</strong>
          <span>{health.message ?? 'Checking official provider status'}</span>
        </div>
      </div>

      <div className="provider-health-grid">
        <div className={health.onemap ? 'provider-health-row ready' : 'provider-health-row pending'}>
          {health.onemap ? <CheckCircle2 size={15} /> : <KeyRound size={15} />}
          <span>
            <strong>OneMap</strong>
            <small>{oneMapDetail}</small>
          </span>
        </div>

        <div className={health.lta ? 'provider-health-row ready' : 'provider-health-row pending'}>
          {health.lta ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}
          <span>
            <strong>LTA DataMall</strong>
            <small>{health.lta ? 'Transit and parking feeds ready' : 'Waiting for AccountKey'}</small>
          </span>
        </div>
      </div>
    </section>
  )
}

function getOneMapDetail(health: ProviderHealth) {
  if (!health.onemap) {
    return health.status === 'disabled' ? 'Gateway not configured' : 'Credential pending'
  }

  if (health.onemapMode === 'access-token') {
    const expiresAt = formatExpiry(health.onemapTokenExpiresAt)
    return expiresAt ? `Live token until ${expiresAt}` : 'Live temporary token'
  }

  return 'Live with server login'
}

function formatExpiry(value?: string | null) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}
