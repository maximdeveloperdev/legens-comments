"use client"

import Image from "next/image"
import { commentMediaLabel, isCommentVideo } from "@/lib/comment-media"

export function CommentMediaPreview({ src, name = src, mime = "", className, width = 96, height = 96, controls = false }: {
  src: string
  name?: string
  mime?: string
  className?: string
  width?: number
  height?: number
  controls?: boolean
}) {
  if (isCommentVideo(name, mime)) {
    return <video src={src} aria-label="Видео MP4" controls={controls} playsInline preload="metadata" width={width} height={height} className={className} />
  }
  return <Image src={src} alt={commentMediaLabel(name, mime)} width={width} height={height} className={className} loading="lazy" unoptimized={src.startsWith("blob:") || commentMediaLabel(name, mime) === "GIF"} />
}
