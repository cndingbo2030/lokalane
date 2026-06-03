import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  EyeOff,
  MapPinned,
  ShieldCheck,
} from 'lucide-react'
import {
  communityAgents,
  getCommunityAgentForPlace,
  getCommunityPostsForAgent,
} from '../data/community'
import type { CommunityPost, CommunityPostStatus, Place } from '../domain/types'

interface CommunityPanelProps {
  selectedPlace?: Place
  onQueryChange: (query: string) => void
}

export function CommunityPanel({ selectedPlace, onQueryChange }: CommunityPanelProps) {
  const agent = getCommunityAgentForPlace(selectedPlace)
  const posts = getCommunityPostsForAgent(agent.id)

  return (
    <section className="community-panel" aria-label="Local community intelligence">
      <div className="community-hero">
        <span className="community-agent-icon large">
          <Bot size={21} />
        </span>
        <div>
          <p className="eyebrow">Community, without noise</p>
          <h2>{agent.title}</h2>
          <p>{agent.subtitle}</p>
        </div>
        <span className="trust-score">{agent.healthScore}% trust</span>
      </div>

      <div className="community-focus-grid" aria-label="Community focus">
        {agent.focus.map((item) => (
          <span key={item}>
            <MapPinned size={14} />
            {item}
          </span>
        ))}
      </div>

      <section className="trust-gate" aria-label="Community compliance controls">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Trust gate</p>
            <h2>Helpful first, compliant always</h2>
          </div>
          <ShieldCheck size={20} />
        </div>
        <div className="trust-gate-grid">
          <article>
            <CheckCircle2 size={16} />
            <strong>Allowed sources</strong>
            <span>{agent.sourcePolicy.join(' · ')}</span>
          </article>
          <article>
            <EyeOff size={16} />
            <strong>Privacy guard</strong>
            <span>{agent.guardrails.join(' · ')}</span>
          </article>
          <article>
            <Clock3 size={16} />
            <strong>Quiet rhythm</strong>
            <span>{agent.quietHoursNote}</span>
          </article>
        </div>
      </section>

      <section className="brief-list" aria-label="AI-maintained community briefs">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Local briefs</p>
            <h2>AI organized, source-labelled</h2>
          </div>
        </div>
        {posts.map((post) => (
          <button
            key={post.id}
            type="button"
            className="brief-card"
            onClick={() => {
              if (post.query) {
                onQueryChange(post.query)
              }
            }}
          >
            <span className={`brief-status ${post.status}`}>
              {getStatusIcon(post.status)}
            </span>
            <span className="brief-copy">
              <strong>{post.title}</strong>
              <small>{post.summary}</small>
              <em>{getStatusLabel(post.status)} · {post.sourceLabel} · {Math.round(post.confidence * 100)}%</em>
            </span>
            <ChevronRight size={17} />
          </button>
        ))}
      </section>

      <section className="action-shelf" aria-label="Useful community searches">
        <div>
          <p className="eyebrow">Convenience</p>
          <h2>Useful, not spammy</h2>
        </div>
        <div>
          {agent.convenienceActions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => onQueryChange(action.query)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </section>

      <section className="agent-switcher" aria-label="Other community stewards">
        {communityAgents
          .filter((candidate) => candidate.id !== agent.id)
          .map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => onQueryChange(candidate.area)}
            >
              <span>{candidate.area}</span>
              <small>{candidate.focus.slice(0, 2).join(' · ')}</small>
            </button>
          ))}
      </section>
    </section>
  )
}

function getStatusIcon(status: CommunityPostStatus) {
  if (status === 'needs-review') {
    return <CircleAlert size={15} />
  }

  return <CheckCircle2 size={15} />
}

function getStatusLabel(status: CommunityPost['status']) {
  const labels: Record<CommunityPost['status'], string> = {
    'auto-published': 'Auto-publish safe',
    'human-reviewed': 'Human reviewed',
    'needs-review': 'Needs review',
  }

  return labels[status]
}
