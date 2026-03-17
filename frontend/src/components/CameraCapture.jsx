import { useState, useRef, useCallback, useEffect } from 'react'

/**
 * Full-screen camera overlay that captures high-res photos using
 * getUserMedia + ImageCapture API (falls back to canvas grab).
 *
 * Props:
 *   onCapture(blob)  — called with the captured image Blob
 *   onClose()        — called when user dismisses the camera
 */
export default function CameraCapture({ onCapture, onClose }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [preview, setPreview] = useState(null) // { url, blob }
  const [error, setError] = useState(null)

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  // Start camera on mount
  useEffect(() => {
    let cancelled = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 4096 },
            height: { ideal: 4096 },
          },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => setReady(true)
        }
      } catch (err) {
        if (!cancelled) setError(err.name === 'NotAllowedError'
          ? 'Camera access denied. Please allow camera access and try again.'
          : 'Could not access camera.')
      }
    }
    start()

    return () => { cancelled = true; stopStream() }
  }, [stopStream])

  const capture = useCallback(async () => {
    const stream = streamRef.current
    if (!stream) return

    try {
      // Try ImageCapture API first (native photo resolution)
      const track = stream.getVideoTracks()[0]
      if (typeof ImageCapture !== 'undefined') {
        const ic = new ImageCapture(track)
        const blob = await ic.takePhoto()
        setPreview({ url: URL.createObjectURL(blob), blob })
        return
      }
    } catch {
      // Fall through to canvas capture
    }

    // Fallback: grab frame from video at its current resolution
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0)
    canvas.toBlob(blob => {
      if (blob) setPreview({ url: URL.createObjectURL(blob), blob })
    }, 'image/jpeg', 0.95)
  }, [])

  const retake = useCallback(() => {
    if (preview) URL.revokeObjectURL(preview.url)
    setPreview(null)
  }, [preview])

  const usePhoto = useCallback(() => {
    if (preview) {
      onCapture(preview.blob)
      stopStream()
    }
  }, [preview, onCapture, stopStream])

  const handleClose = useCallback(() => {
    stopStream()
    if (preview) URL.revokeObjectURL(preview.url)
    onClose()
  }, [stopStream, preview, onClose])

  return (
    <div className="camera-overlay">
      {error ? (
        <div className="camera-error">
          <p>{error}</p>
          <button className="camera-btn" onClick={handleClose}>Close</button>
        </div>
      ) : preview ? (
        <>
          <img className="camera-preview" src={preview.url} alt="Captured receipt" />
          <div className="camera-controls">
            <button className="camera-btn" onClick={retake}>Retake</button>
            <button className="camera-btn primary" onClick={usePhoto}>Use photo</button>
          </div>
        </>
      ) : (
        <>
          <video
            ref={videoRef}
            className="camera-viewfinder"
            autoPlay
            playsInline
            muted
          />
          {!ready && <div className="camera-loading">Starting camera...</div>}
          <div className="camera-controls">
            <button className="camera-btn" onClick={handleClose}>Cancel</button>
            <button
              className="camera-shutter"
              onClick={capture}
              disabled={!ready}
              aria-label="Take photo"
            />
            <div className="camera-spacer" />
          </div>
        </>
      )}
    </div>
  )
}
