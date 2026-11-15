import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

export function HeroMedia() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const reduceMotion = useReducedMotion()
  const [videoFailed, setVideoFailed] = useState(false)

  // Media paths must be base-aware: on GitHub Pages the app lives under
  // /agnidrishti/, so a root-relative "/videos/..." would 404 and the hero would
  // silently fall back to the static poster.
  const mediaBase = `${import.meta.env.BASE_URL}videos/`

  useEffect(() => {
    const video = videoRef.current
    if (!video || reduceMotion) return

    const attemptPlayback = async () => {
      try {
        await video.play()
      } catch {
        setVideoFailed(true)
      }
    }

    void attemptPlayback()
  }, [reduceMotion])

  const showVideo = !reduceMotion && !videoFailed

  return (
    <div className="absolute inset-0 overflow-hidden bg-ink" aria-hidden="true">
      <motion.div
        initial={reduceMotion ? false : { scale: 1.035 }}
        animate={{ scale: 1 }}
        transition={{ duration: 1.7, ease: [0.22, 1, 0.36, 1] }}
        className="absolute inset-0 will-change-transform"
      >
        <div
          className="absolute inset-0 bg-cover bg-[62%_center] lg:bg-center"
          style={{ backgroundImage: `url('${mediaBase}fire-hero-poster.jpg')` }}
        />

        {showVideo ? (
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover object-[62%_center] lg:object-center"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            poster={`${mediaBase}fire-hero-poster.jpg`}
            disablePictureInPicture
            onError={() => setVideoFailed(true)}
          >
            <source src={`${mediaBase}fire-hero-bg.webm`} type="video/webm" />
            <source src={`${mediaBase}fire-hero-bg.mp4`} type="video/mp4" />
          </video>
        ) : null}
      </motion.div>

      <div className="absolute inset-0 hero-shade" />
    </div>
  )
}
