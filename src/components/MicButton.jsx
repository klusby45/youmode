import { useRef, useState } from 'react'
import Icon from './Icons.jsx'
import * as api from '../data.js'

// A small tap-to-talk button: records one clip, transcribes it (Whisper), and
// hands the text back via onText. People would rather ramble than type — this
// drops dictation next to any input. Silently absent when there's no mic.
const micSupported = typeof navigator !== 'undefined'
  && !!navigator.mediaDevices?.getUserMedia
  && typeof window !== 'undefined' && !!window.MediaRecorder

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onloadend = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

// A recorder is restarted every few minutes so each segment is a complete,
// independently decodable file. One long take cannot be split after the fact:
// slicing an m4a or webm gives you pieces that only the first of which has
// headers, and Netlify will not accept a body much past 6 MB anyway. Talking
// for twenty minutes now costs several small uploads instead of one that gets
// rejected at the end.
const SEGMENT_MS = 3 * 60 * 1000

export default function MicButton({ onText, disabled }) {
  const [state, setState] = useState('idle') // idle | recording | transcribing
  const recRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const segmentsRef = useRef([])   // completed blobs, in order
  const rollTimer = useRef(null)
  const stopping = useRef(false)   // true once the user asked to stop
  if (!micSupported) return null

  function newRecorder(stream) {
    const MR = window.MediaRecorder
    const mime = MR.isTypeSupported?.('audio/webm') ? 'audio/webm'
      : MR.isTypeSupported?.('audio/mp4') ? 'audio/mp4' : ''
    const rec = mime ? new MR(stream, { mimeType: mime }) : new MR(stream)
    chunksRef.current = []
    rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data) }
    rec.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
      if (blob.size) segmentsRef.current.push(blob)
      if (!stopping.current) {
        // Rolled over mid-recording: pick straight back up on the same stream.
        recRef.current = newRecorder(stream)
        recRef.current.start()
        rollTimer.current = setTimeout(roll, SEGMENT_MS)
        return
      }
      clearTimeout(rollTimer.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      await finish()
    }
    return rec
  }

  function roll() {
    try { recRef.current?.stop() } catch { /* already stopped */ }
  }

  // Transcribe each segment in order and hand back one joined block of text.
  // A segment that fails does not take the rest of the recording with it.
  async function finish() {
    const segs = segmentsRef.current
    segmentsRef.current = []
    if (!segs.length) { setState('idle'); return }
    setState('transcribing')
    const parts = []
    let failed = 0
    for (const blob of segs) {
      try {
        const b64 = await blobToBase64(blob)
        const { text } = await api.transcribeAudio(b64, blob.type)
        if (text?.trim()) parts.push(text.trim())
      } catch { failed++ }
    }
    if (parts.length) {
      onText(parts.join(' ') + (failed ? ' [part of this recording did not come through]' : ''))
    }
    setState('idle')
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      segmentsRef.current = []
      stopping.current = false
      recRef.current = newRecorder(stream)
      recRef.current.start()
      rollTimer.current = setTimeout(roll, SEGMENT_MS)
      setState('recording')
    } catch { setState('idle') }
  }

  function stop() {
    stopping.current = true
    clearTimeout(rollTimer.current)
    try { recRef.current?.stop() } catch { /* already stopped */ }
  }

  const label = state === 'recording' ? 'Stop and add' : state === 'transcribing' ? 'Writing it down…' : 'Tap to talk'
  return (
    <button type="button" className={'mic-btn' + (state === 'recording' ? ' rec' : '')}
      disabled={disabled || state === 'transcribing'} title={label} aria-label={label}
      onClick={state === 'recording' ? stop : start}>
      <Icon name={state === 'recording' ? 'stop' : 'mic'} size={18} />
    </button>
  )
}
