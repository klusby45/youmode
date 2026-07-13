// The single photo-visibility rule (app-layer; friendly-parties model).
// You always see your own photos. The referee ALWAYS sees photos — verdicts
// need evidence, that's the integrity contract. Otherwise: a requirement
// marked private never shows its photos to others, and everything else
// follows the owner's account-level setting ('all' shares photos with
// challenge-mates; null/'icons' shows icon-level progress + captions only).
export function canSeePhotos({ viewerId, viewerIsReferee, ownerUserId, ownerSharing, req }) {
  if (viewerId === ownerUserId) return true
  if (viewerIsReferee) return true
  if (req?.isPrivate) return false
  return (ownerSharing ?? 'icons') === 'all'
}
