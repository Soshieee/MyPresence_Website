"use client";

import Image from "next/image";
import { useState } from "react";

type CalendarImageProps = {
  src: string | null;
  alt: string;
  emptyMessage?: string;
  className?: string;
  priority?: boolean;
};

type ImageState = "loading" | "loaded" | "error";

type ImageStatus = {
  src: string | null;
  state: ImageState;
};

export default function CalendarImage({
  src,
  alt,
  emptyMessage = "No calendar image has been uploaded yet.",
  className = "aspect-[4/3] w-full",
  priority = false
}: CalendarImageProps) {
  const [imageStatus, setImageStatus] = useState<ImageStatus>({
    src,
    state: src ? "loading" : "error"
  });

  const imageState: ImageState =
    imageStatus.src === src ? imageStatus.state : src ? "loading" : "error";

  if (!src) {
    return (
      <div
        className={`flex items-center justify-center rounded-2xl border border-dashed border-[#b9cbc3] bg-[#f4f8f6] px-6 py-10 text-center text-sm text-[#5d7369] ${className}`}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-[#b9cbc3] bg-[#eef4f1] ${className}`}>
      {imageState === "loading" ? (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-[#e4eee9] via-[#f3f8f5] to-[#dce8e3]" />
      ) : null}

      {imageState === "error" ? (
        <div className="flex h-full min-h-40 w-full items-center justify-center px-6 text-center text-sm text-[#7a3237]">
          The calendar image could not be loaded.
        </div>
      ) : (
        <Image
          src={src}
          alt={alt}
          fill
          unoptimized
          priority={priority}
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 70vw, 900px"
          className={`object-contain transition-opacity duration-300 ${
            imageState === "loaded" ? "opacity-100" : "opacity-0"
          }`}
          onLoad={() => setImageStatus({ src, state: "loaded" })}
          onError={() => setImageStatus({ src, state: "error" })}
        />
      )}
    </div>
  );
}
