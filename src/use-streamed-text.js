import { useEffect, useRef, useState } from 'react'

function completeWords(text) {
  const boundary = text.search(/\S+$/u)
  if (boundary === 0 && text.length < 64) return ''
  return boundary > 0 && text.length - boundary < 64 ? text.slice(0, boundary) : text
}

export default function useStreamedText(text, generating) {
  const latest = useRef(text)
  latest.current = text
  const [shown, setShown] = useState(text)
  useEffect(() => {
    if (!generating) return
    const timer = setInterval(() => setShown(completeWords(latest.current)), 80)
    return () => clearInterval(timer)
  }, [generating])
  if (!generating) return text
  return text.startsWith(shown) ? shown : completeWords(text)
}
