export interface NavLink {
  id: string
  title: string
  url: string
  category: string
  description: string
  icon: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type NavLinkMutation = Omit<NavLink, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string
}

export type ImportMode = 'merge' | 'replace'
