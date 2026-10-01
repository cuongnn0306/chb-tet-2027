export const ROUTES = {
  home: '/',
  login: '/login',
  admin: {
    locations: '/admin/locations',
    salesChannels: '/admin/sales-channels',
    leadSources: '/admin/lead-sources',
  },
} as const

/** Entries of the Admin "Danh mục" menu, in display order. */
export const ADMIN_NAV = [
  { to: ROUTES.admin.locations, label: 'Địa điểm' },
  { to: ROUTES.admin.salesChannels, label: 'Kênh bán' },
  { to: ROUTES.admin.leadSources, label: 'Nguồn khách' },
] as const
