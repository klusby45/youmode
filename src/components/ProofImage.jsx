import { useEffect, useState } from 'react'
import { useApp } from '../appContext.js'

// Resolves a storage path to a (signed) URL. In demo mode the path already IS
// the URL, so this returns immediately.
export default function ProofImage({ path, alt }) {
  const { actions } = useApp()
  const [url, setUrl] = useState(null)

  useEffect(() => {
    let alive = true
    if (!path) { setUrl(null); return }
    actions.signedUrl(path).then((u) => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [path, actions])

  if (!url) return null
  return <img src={url} alt={alt || ''} loading="lazy" />
}
