import { CheckCircle2, CircleAlert, Clock3, DatabaseZap } from 'lucide-react'
import type { ProviderHealth } from '../services/providerHealth'
import { LokaBuddy } from './LokaBuddy'

interface ProviderStatusCardProps {
  health: ProviderHealth
}

export function ProviderStatusCard({ health }: ProviderStatusCardProps) {
  const isReady = health.status === 'ready'

  return (
    <section className={`provider-health ${health.status}`} aria-label="Data readiness">
      <div className="provider-health-heading">
        <span className="provider-health-icon">
          {isReady ? <LokaBuddy /> : <CircleAlert size={16} />}
        </span>
        <div>
          <strong>{isReady ? 'Data ready' : 'Map still works'}</strong>
          <span>
            {isReady
              ? 'Official places and local tips are checked before they appear.'
              : 'Local results stay available while official feeds connect.'}
          </span>
        </div>
      </div>

      <div className="provider-health-grid">
        <div className={health.onemap ? 'provider-health-row ready' : 'provider-health-row pending'}>
          {health.onemap ? <CheckCircle2 size={15} /> : <DatabaseZap size={15} />}
          <span>
            <strong>Places</strong>
            <small>{health.onemap ? 'Official search on' : 'Local search now'}</small>
          </span>
        </div>

        <div className={health.lta ? 'provider-health-row ready' : 'provider-health-row pending'}>
          {health.lta ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}
          <span>
            <strong>Transport</strong>
            <small>{health.lta ? 'Live feeds on' : 'Basic routes now'}</small>
          </span>
        </div>
      </div>

      <div className="friendly-badge-row" aria-label="Friendly app promises">
        <span>Easy start</span>
        <span>Quiet Nearby</span>
        <span>Clear labels</span>
      </div>
    </section>
  )
}
