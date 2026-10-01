export const ROUTES = {
  home: '/',
  login: '/login',
  customers: '/customers',
  orders: '/orders',
  inventory: '/inventory',
  inventoryBatches: '/inventory/batches',
  inventoryMovements: '/inventory/movements',
  inventoryImport: '/inventory/import',
  orderNew: '/orders/new',
  orderDetail: (id: string) => `/orders/${id}`,
  orderEdit: (id: string) => `/orders/${id}/edit`,
  orderPrint: (id: string) => `/orders/${id}/print`,
  admin: {
    locations: '/admin/locations',
    salesChannels: '/admin/sales-channels',
    leadSources: '/admin/lead-sources',
    products: '/admin/products',
    commissionRules: '/admin/commission-rules',
    safetyStock: '/admin/safety-stock',
    settings: '/admin/settings',
  },
} as const

/** Entries of the Admin "Danh mục" menu, in display order. */
export const ADMIN_NAV = [
  { to: ROUTES.admin.locations, label: 'Địa điểm' },
  { to: ROUTES.admin.salesChannels, label: 'Kênh bán' },
  { to: ROUTES.admin.leadSources, label: 'Nguồn khách' },
  { to: ROUTES.admin.products, label: 'Sản phẩm' },
  { to: ROUTES.admin.commissionRules, label: 'Hoa hồng' },
  { to: ROUTES.admin.safetyStock, label: 'Tồn an toàn' },
  { to: ROUTES.admin.settings, label: 'Cấu hình' },
] as const
