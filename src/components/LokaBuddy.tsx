interface LokaBuddyProps {
  size?: 'small' | 'large'
}

export function LokaBuddy({ size = 'small' }: LokaBuddyProps) {
  return (
    <span className={`loka-buddy ${size}`} aria-hidden="true">
      <span />
    </span>
  )
}
