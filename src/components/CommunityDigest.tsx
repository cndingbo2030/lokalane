import { ChevronRight, ShieldCheck } from 'lucide-react'
import { getCommunityAgentForPlace, getCommunityPostsForAgent } from '../data/community'
import type { AppView, Place } from '../domain/types'
import { LokaBuddy } from './LokaBuddy'

interface CommunityDigestProps {
  place?: Place
  onQueryChange: (query: string) => void
  onViewChange: (view: AppView) => void
}

export function CommunityDigest({
  place,
  onQueryChange,
  onViewChange,
}: CommunityDigestProps) {
  const agent = getCommunityAgentForPlace(place)
  const [leadPost] = getCommunityPostsForAgent(agent.id)

  return (
    <section className="community-digest" aria-label="Local community digest">
      <div className="community-digest-heading">
        <span className="community-agent-icon">
          <LokaBuddy />
        </span>
        <div>
          <p className="eyebrow">Local helper</p>
          <strong>{agent.area}</strong>
        </div>
        <span className="trust-chip">
          <ShieldCheck size={14} />
          {agent.healthScore}%
        </span>
      </div>

      {leadPost ? (
        <button
          type="button"
          className="community-digest-post"
          onClick={() => {
            if (leadPost.query) {
              onQueryChange(leadPost.query)
            }
          }}
        >
          <span>
            <strong>{leadPost.title}</strong>
            <small>{leadPost.summary}</small>
          </span>
          <ChevronRight size={17} />
        </button>
      ) : null}

      <div className="community-digest-footer">
        <span>AI-assisted, quiet by default</span>
        <button type="button" onClick={() => onViewChange('community')}>
          Open Nearby
        </button>
      </div>
    </section>
  )
}
