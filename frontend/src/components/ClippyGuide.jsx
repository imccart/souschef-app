import { useState, useEffect } from 'react'
import clippyImg from '../assets/clippy-chef.png'
import mouseImg from '../assets/mouse-chef.png'
import styles from './OnboardingFlow.module.css'

export default function ClippyGuide({ quip, showMouse }) {
  const [mouseVisible, setMouseVisible] = useState(false)
  const [mouseRunning, setMouseRunning] = useState(false)

  useEffect(() => {
    if (showMouse) {
      const t1 = setTimeout(() => setMouseVisible(true), 500)
      const t2 = setTimeout(() => setMouseRunning(true), 1800)
      return () => { clearTimeout(t1); clearTimeout(t2) }
    }
  }, [showMouse])

  return (
    <div className={styles.clippyContainer}>
      {quip && (
        <div className={styles.clippyBubble}>
          <span>{quip}</span>
          <div className={styles.clippyBubbleTail} />
        </div>
      )}
      <div className={styles.clippyCharacter}>
        <img
          src={clippyImg}
          alt="Clippy the chef"
          className={`${styles.clippyImg}${showMouse ? ` ${styles.clippyWave}` : ''}`}
        />
        {mouseVisible && (
          <img
            src={mouseImg}
            alt=""
            className={`${styles.mouseImg}${mouseRunning ? ` ${styles.mouseScurry}` : ''}`}
          />
        )}
      </div>
    </div>
  )
}
