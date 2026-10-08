import { Fragment, type ReactNode } from 'react'

/**
 * Tiny, safe Markdown subset (headings, bullets, bold, italics) for model output.
 * Renders React elements only — model text is never injected as HTML.
 */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: ReactNode[] = []

  const flushList = () => {
    if (list.length) blocks.push(<ul key={`ul-${blocks.length}`}>{list}</ul>)
    list = []
  }

  text.split('\n').forEach((raw, index) => {
    const line = raw.trimEnd()
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/) ?? line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (bullet) {
      list.push(<li key={index}>{inline(bullet[1])}</li>)
      return
    }
    flushList()
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      blocks.push(<h4 key={index} className={`md-h${heading[1].length}`}>{inline(heading[2])}</h4>)
    } else if (line.trim().startsWith('↳')) {
      // Translation of the suggested reply into the user's language.
      blocks.push(<p key={index} className="md-translation">{inline(line.trim())}</p>)
    } else if (line.trim()) {
      blocks.push(<p key={index}>{inline(line)}</p>)
    }
  })
  flushList()
  return <div className="markdown">{blocks}</div>
}

function inline(text: string): ReactNode {
  // `_x_` is italic only at word boundaries, so identifiers like API_KEY stay intact.
  const parts = text.split(/(\*\*[^*]+\*\*|(?<!\w)_[^_\s][^_]*_(?!\w))/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('_') && part.endsWith('_') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>
    return <Fragment key={i}>{part}</Fragment>
  })
}
