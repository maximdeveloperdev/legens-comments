"use client"

import { useTranslations } from "@/components/language-provider"

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
  const t = useTranslations()

  if (isCommentVideo(name, mime)) {
    return <video src={src} aria-label={t("Видео MP4")} controls={controls} playsInline preload="metadata" width={width} height={height} className={className} />
  }
  return <Image src={src} alt={t(commentMediaLabel(name, mime))} width={width} height={height} className={className} loading="lazy" unoptimized={src.startsWith("blob:") || commentMediaLabel(name, mime) === "GIF"} />
}
