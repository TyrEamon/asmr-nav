import type { NavLink } from '../types/nav'

export function formatDateLabel(value: Date) {
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  return `${value.getMonth() + 1}月${value.getDate()}日 ${weekdays[value.getDay()]}`
}

export function formatClock(value: Date) {
  const hours = String(value.getHours()).padStart(2, '0')
  const minutes = String(value.getMinutes()).padStart(2, '0')
  const seconds = String(value.getSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

export function getHostLabel(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return value
  }
}

export function getLinkIcon(link: Pick<NavLink, 'icon' | 'title'>) {
  const icon = link.icon.trim()

  if (icon) {
    return icon.slice(0, 3)
  }

  const ascii = link.title.match(/[a-z0-9]/i)?.[0]

  if (ascii) {
    return ascii.toUpperCase()
  }

  return link.title.slice(0, 1) || '站'
}

export function downloadTextFile(filename: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
