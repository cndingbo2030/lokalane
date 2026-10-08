import type { LatencyStats, MetricsSnapshot } from '../../shared/protocol.ts'

const seconds = (stats: LatencyStats) => (stats.p50 === null ? '—' : `${(stats.p50 / 1000).toFixed(1)}s`)

/**
 * Live quality/cost readout: what the user feels (latency) and what it costs,
 * plus how much of the talking the user is doing (when their voice is known).
 */
export function MetricsBar({ metrics, elapsedSeconds, myShare }: { metrics?: MetricsSnapshot; elapsedSeconds: number; myShare?: number | null }) {
  if (!metrics) return null
  const sent = metrics.audioSentSeconds.me + metrics.audioSentSeconds.remote
  const tokens = Object.values(metrics.llm).reduce((sum, r) => sum + r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens, 0)
  const rated = metrics.suggestions.up + metrics.suggestions.down
  return (
    <dl className="metrics" aria-label="会议指标">
      <div title={`P95 ${metrics.suggestionLatencyMs.p95 ?? '—'} ms · 已显示 ${metrics.suggestions.shown} 条 · 模型判断无需建议 ${metrics.suggestions.skipped} 次`}>
        <dt>建议延迟</dt>
        <dd>{seconds(metrics.suggestionLatencyMs)}</dd>
      </div>
      <div title={`P95 ${metrics.translationLatencyMs.p95 ?? '—'} ms · ${metrics.translationLatencyMs.count} 句`}>
        <dt>翻译延迟</dt>
        <dd>{seconds(metrics.translationLatencyMs)}</dd>
      </div>
      <div title={`我 ${metrics.audioSentSeconds.me}s · 对方 ${metrics.audioSentSeconds.remote}s（会议已进行 ${elapsedSeconds}s）`}>
        <dt>识别音频</dt>
        <dd>{(sent / 60).toFixed(1)} 分钟</dd>
      </div>
      <div title="Claude 输入 + 输出 + 缓存 token">
        <dt>Tokens</dt>
        <dd>{tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens}</dd>
      </div>
      <div title="按 Claude 公开价格估算，不含语音识别费用">
        <dt>预估费用</dt>
        <dd>${metrics.costUsd.toFixed(2)}</dd>
      </div>
      {myShare !== undefined && myShare !== null && (
        <div title="你的发言时间占全部发言的比例（会后见「会议分析」）">
          <dt>我的发言</dt>
          <dd>{Math.round(myShare * 100)}%</dd>
        </div>
      )}
      {rated > 0 && (
        <div title="对 AI 建议的反馈">
          <dt>建议好评</dt>
          <dd>{Math.round((metrics.suggestions.up / rated) * 100)}%</dd>
        </div>
      )}
      {metrics.errors > 0 && (
        <div className="warn">
          <dt>错误</dt>
          <dd>{metrics.errors}</dd>
        </div>
      )}
    </dl>
  )
}
