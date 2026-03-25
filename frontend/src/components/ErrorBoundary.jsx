import { Component } from 'react'
import FeedbackFab from './FeedbackFab'
import styles from './ErrorBoundary.module.css'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return <ErrorScreen onRefresh={() => window.location.reload()} />
    }
    return this.props.children
  }
}

export function ErrorScreen({ onRefresh }) {
  return (
    <div className={styles.boundary}>
      <div className={styles.scene}>
        <div className={styles.droppedBag}>
          <div className={styles.bagBody}>
            <div className={styles.bagHandleLeft}></div>
            <div className={styles.bagHandleRight}></div>
            <div className={styles.bagFront}></div>
          </div>
          <div className={`${styles.spill} ${styles.spill1}`}>{'\u{1F966}'}</div>
          <div className={`${styles.spill} ${styles.spill2}`}>{'\u{1F34E}'}</div>
          <div className={`${styles.spill} ${styles.spill3}`}>{'\u{1F956}'}</div>
          <div className={`${styles.spill} ${styles.spill4}`}>{'\u{1F95A}'}</div>
          <div className={`${styles.spill} ${styles.spill5}`}>{'\u{1F955}'}</div>
        </div>
      </div>
      <h2 className={styles.title}>We dropped something</h2>
      <p className={styles.sub}>
        Sorry about the mess. Try refreshing, or let us know what happened.
      </p>
      <div className={styles.actions}>
        <button className={styles.refresh} onClick={onRefresh}>
          Try again
        </button>
      </div>
      <FeedbackFab page="error" />
    </div>
  )
}

export function CrashTest() {
  throw new Error('Test crash — everything is fine!')
}
