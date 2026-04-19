import { useState } from 'react'
import Sheet from './Sheet'
import { api } from '../api/client'

export default function FeedbackFab({ page }) {
  const [show, setShow] = useState(false)
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)

  return (
    <>
      <button className="feedback-fab" data-tour="feedback" onClick={() => { setShow(true); setSent(false); setText('') }}>
        Talk to the manager
      </button>

      {show && (
        <Sheet onClose={() => setShow(false)}>
          {sent ? (
            <div className="feedback-thanks">
              <div className="feedback-title">Yes, Chef!</div>
            </div>
          ) : (
            <>
              <div className="sheet-title feedback-title">I'd like to speak to the manager</div>
              <textarea
                className="feedback-textarea"
                placeholder="What's on your mind?"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                autoFocus
              />
              <button
                className="btn primary"
                style={{ width: '100%', marginTop: 12 }}
                disabled={!text.trim() || sending}
                onClick={async () => {
                  setSending(true)
                  try {
                    await api.sendFeedback(text.trim(), page)
                    setSent(true)
                  } catch { /* silent */ }
                  setSending(false)
                }}
              >
                {sending ? 'Sending...' : 'Send'}
              </button>
            </>
          )}
        </Sheet>
      )}
    </>
  )
}
