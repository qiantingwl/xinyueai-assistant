export const IMAGE_VIEWER_ZOOM_MIN = 1
export const IMAGE_VIEWER_ZOOM_MAX = 4
export const IMAGE_VIEWER_ZOOM_STEP = 0.25

export interface ImageViewerPan {
  x: number
  y: number
}

export interface ImageViewerSize {
  width: number
  height: number
}

export function clampImageViewerZoom(requestedZoom: number): number {
  if (!Number.isFinite(requestedZoom)) return IMAGE_VIEWER_ZOOM_MIN
  return Math.max(IMAGE_VIEWER_ZOOM_MIN, Math.min(IMAGE_VIEWER_ZOOM_MAX, requestedZoom))
}

export function clampImageViewerPan(
  candidate: ImageViewerPan,
  image: ImageViewerSize,
  viewport: ImageViewerSize,
  requestedZoom: number,
): ImageViewerPan {
  const zoom = clampImageViewerZoom(requestedZoom)
  if (zoom <= IMAGE_VIEWER_ZOOM_MIN) return { x: 0, y: 0 }

  const imageWidth = Math.max(0, image.width)
  const imageHeight = Math.max(0, image.height)
  const viewportWidth = Math.max(0, viewport.width)
  const viewportHeight = Math.max(0, viewport.height)
  const maxX = Math.max(0, (imageWidth * zoom - viewportWidth) / 2)
  const maxY = Math.max(0, (imageHeight * zoom - viewportHeight) / 2)

  return {
    x: Math.max(-maxX, Math.min(maxX, candidate.x)),
    y: Math.max(-maxY, Math.min(maxY, candidate.y)),
  }
}
