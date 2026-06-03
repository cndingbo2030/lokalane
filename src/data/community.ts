import type { CommunityAgent, CommunityPost, Place } from '../domain/types'

export const communityAgents: CommunityAgent[] = [
  {
    id: 'woodlands-steward',
    area: 'Woodlands',
    title: 'Woodlands AI steward',
    subtitle: 'Checkpoint, JB travel, rooms, movers and commute alerts.',
    placeIds: ['woodlands-checkpoint', 'jb-city-square'],
    focus: ['Checkpoint flow', 'Room leads', 'Moving-out deals', 'Bus 950'],
    healthScore: 94,
    updatedAt: '2026-06-03T08:20:00+08:00',
    quietHoursNote: 'Caps AI posts to essential alerts during late hours.',
    guardrails: ['No private group scraping', 'Rental posts need review', 'Personal data masked'],
    sourcePolicy: ['Official feeds', 'Verified merchants', 'LokaLane user reports'],
    convenienceActions: [
      { label: 'JB food near arrival', query: 'jb food' },
      { label: 'Room rental leads', query: 'room rental woodlands' },
      { label: 'Moving services', query: 'mover woodlands' },
    ],
  },
  {
    id: 'orchard-steward',
    area: 'Orchard',
    title: 'Orchard AI steward',
    subtitle: 'Visitor-friendly food, malls, events and MRT access.',
    placeIds: ['orchard-road', 'marina-bay-sands', 'gardens-by-the-bay', 'lau-pa-sat'],
    focus: ['Food', 'Attractions', 'Retail events', 'MRT routes'],
    healthScore: 91,
    updatedAt: '2026-06-03T08:10:00+08:00',
    quietHoursNote: 'Keeps tourist picks separate from local commute results.',
    guardrails: ['Sponsored labels required', 'No fake reviews', 'Source shown on every brief'],
    sourcePolicy: ['Official places', 'Merchant submissions', 'Curated tourism records'],
    convenienceActions: [
      { label: 'Hawker food', query: 'hawker food' },
      { label: 'Attractions by MRT', query: 'attraction mrt' },
      { label: 'Hotel area search', query: 'hotel orchard' },
    ],
  },
  {
    id: 'punggol-steward',
    area: 'Punggol',
    title: 'Punggol AI steward',
    subtitle: 'HDB blocks, family services, clinics, schools and daily commute.',
    placeIds: ['punggol-interchange'],
    focus: ['HDB search', 'Family services', 'Bus/LRT', 'Second-hand'],
    healthScore: 89,
    updatedAt: '2026-06-03T08:05:00+08:00',
    quietHoursNote: 'Groups neighbourhood posts into calm daily digests.',
    guardrails: ['No personal accusations', 'First-time posters reviewed', 'Report path visible'],
    sourcePolicy: ['Official transport', 'Verified service providers', 'Resident reports'],
    convenienceActions: [
      { label: 'Home services', query: 'cleaning punggol' },
      { label: 'Second-hand nearby', query: 'second hand punggol' },
      { label: 'Bus interchange', query: 'punggol interchange' },
    ],
  },
]

export const communityPosts: CommunityPost[] = [
  {
    id: 'woodlands-checkpoint-brief',
    agentId: 'woodlands-steward',
    title: 'Checkpoint commute brief',
    summary: 'AI grouped official transit, community road signals and JB arrival places into one low-noise update.',
    category: 'transport',
    sourceLabel: 'Official + community report',
    status: 'human-reviewed',
    confidence: 0.91,
    updatedAt: '2026-06-03T08:20:00+08:00',
    query: 'woodlands checkpoint',
  },
  {
    id: 'woodlands-room-leads',
    agentId: 'woodlands-steward',
    title: 'Room rental demand watch',
    summary: 'Rental posts stay hidden from the map until identity, location and scam-risk checks pass.',
    category: 'rental',
    sourceLabel: 'Pending marketplace queue',
    status: 'needs-review',
    confidence: 0.84,
    updatedAt: '2026-06-03T07:50:00+08:00',
    query: 'room rental woodlands',
  },
  {
    id: 'orchard-visitor-picks',
    agentId: 'orchard-steward',
    title: 'Visitor picks by public transport',
    summary: 'Food, attractions and mall activity are separated from local commute results to avoid crowding the map.',
    category: 'visitor',
    sourceLabel: 'Curated visitor layer',
    status: 'auto-published',
    confidence: 0.89,
    updatedAt: '2026-06-03T08:10:00+08:00',
    query: 'attraction mrt',
  },
  {
    id: 'orchard-food-brief',
    agentId: 'orchard-steward',
    title: 'Food around Orchard and CBD',
    summary: 'Merchant offers can appear only in discovery surfaces and must be labelled before launch.',
    category: 'food',
    sourceLabel: 'Verified merchant candidate',
    status: 'human-reviewed',
    confidence: 0.86,
    updatedAt: '2026-06-03T08:00:00+08:00',
    query: 'food orchard',
  },
  {
    id: 'punggol-family-services',
    agentId: 'punggol-steward',
    title: 'Home and family service digest',
    summary: 'Cleaning, repairs and tuition leads are grouped by neighbourhood so residents do not see spammy posts.',
    category: 'services',
    sourceLabel: 'Local service queue',
    status: 'human-reviewed',
    confidence: 0.87,
    updatedAt: '2026-06-03T08:05:00+08:00',
    query: 'cleaning punggol',
  },
  {
    id: 'punggol-secondhand',
    agentId: 'punggol-steward',
    title: 'Moving-out and second-hand watch',
    summary: 'Pickup-distance sorting is planned so useful nearby posts rank above paid but irrelevant posts.',
    category: 'second-hand',
    sourceLabel: 'Community marketplace plan',
    status: 'needs-review',
    confidence: 0.82,
    updatedAt: '2026-06-03T07:45:00+08:00',
    query: 'second hand punggol',
  },
]

export function getCommunityAgentForPlace(place?: Place) {
  if (!place) {
    return communityAgents[0]
  }

  return (
    communityAgents.find((agent) => agent.placeIds.includes(place.id)) ??
    communityAgents.find((agent) => agent.area === place.area) ??
    communityAgents[0]
  )
}

export function getCommunityPostsForAgent(agentId: string) {
  return communityPosts.filter((post) => post.agentId === agentId)
}
