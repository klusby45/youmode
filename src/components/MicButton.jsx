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

export default function MicButton({ onText, disabled }) {
  const [state, setState] = useState('idle') // idle | recording | transcribing
  const recRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  if (!micSupported) return null

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const MR = window.MediaRecorder
      const mime = MR.isTypeSupported?.('audio/webm') ? 'audio/webm'
        : MR.isTypeSupported?.('audio/mp4') ? 'audio/mp4' : ''
      const rec = mime ? new MR(stream, { mimeType: mime }) : new MR(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        if (!blob.size) { setState('idle'); return }
        setState('transcribing')
        try {
          const b64 = await blobToBase64(blob)
          const { text } = await api.transcribeAudio(b64, blob.type)
          if (text?.trim()) onText(text.trim())
        } catch { /* leave the box as-is; typing still works */ }
        setState('idle')
      }
      recRef.current = rec
      rec.start()
      setState('recording')
    } catch { setState('idle') }
  }
  function stop() { try { recRef.current?.stop() } catch { /* already stopped */ } }

  const label = state === 'recording' ? 'Stop and add' : state === 'transcribing' ? 'Writing it down…' : 'Tap to talk'
  return (
    <button type="button" className={'mic-btn' + (state === 'recording' ? ' rec' : '')}
      disabled={disabled || state === 'transcribing'} title={label} aria-label={label}
      onClick={state === 'recording' ? stop : start}>
      <Icon name={state === 'recording' ? 'stop' : 'mic'} size={18} />
    </button>
  )
}
