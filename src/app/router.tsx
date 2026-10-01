import { createBrowserRouter } from 'react-router'
import { CustomerListPage } from '@/features/customers/pages/CustomerListPage'
import { BatchStockPage } from '@/features/inventory/pages/BatchStockPage'
import { ImportOpeningStockPage } from '@/features/inventory/pages/ImportOpeningStockPage'
import { InventorySummaryPage } from '@/features/inventory/pages/InventorySummaryPage'
import { MovementHistoryPage } from '@/features/inventory/pages/MovementHistoryPage'
import { DeliveryBoardPage } from '@/features/deliveries/pages/DeliveryBoardPage'
import { DeliveryPrintPage } from '@/features/deliveries/pages/DeliveryPrintPage'
import { PaymentReviewPage } from '@/features/payments/pages/PaymentReviewPage'
import { LoginPage } from '@/features/auth/pages/LoginPage'
import { HomePage } from '@/features/dashboard/pages/HomePage'
import { CommissionRulesPage } from '@/features/master-data/pages/CommissionRulesPage'
import { LeadSourcesPage } from '@/features/master-data/pages/LeadSourcesPage'
import { LocationsPage } from '@/features/master-data/pages/LocationsPage'
import { ProductsPage } from '@/features/master-data/pages/ProductsPage'
import { SafetyStockPage } from '@/features/master-data/pages/SafetyStockPage'
import { SettingsPage } from '@/features/master-data/pages/SettingsPage'
import { SalesChannelsPage } from '@/features/master-data/pages/SalesChannelsPage'
import { AppLayout } from './AppLayout'
import { AuthGuard } from './auth-guard'
import { OrderDetailPage } from '@/features/orders/pages/OrderDetailPage'
import { OrderFormPage } from '@/features/orders/pages/OrderFormPage'
import { OrderListPage } from '@/features/orders/pages/OrderListPage'
import { OrderPrintPage } from '@/features/orders/pages/OrderPrintPage'
import { PermissionRoute } from './PermissionRoute'
import { RoleRoute } from './RoleRoute'
import { ROUTES } from './routes'

export const router = createBrowserRouter([
  { path: ROUTES.login, element: <LoginPage /> },
  {
    element: <AuthGuard />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: ROUTES.home, element: <HomePage /> },
          { path: ROUTES.inventory, element: <InventorySummaryPage /> },
          {
            element: <RoleRoute roles={['ADMIN', 'WAREHOUSE', 'PRODUCTION']} />,
            children: [{ path: ROUTES.inventoryBatches, element: <BatchStockPage /> }],
          },
          {
            element: <RoleRoute roles={['ADMIN']} />,
            children: [
              { path: ROUTES.inventoryImport, element: <ImportOpeningStockPage /> },
              { path: ROUTES.paymentReview, element: <PaymentReviewPage /> },
            ],
          },
          {
            element: <RoleRoute roles={['ADMIN', 'WAREHOUSE']} />,
            children: [
              { path: ROUTES.inventoryMovements, element: <MovementHistoryPage /> },
              {
                path: '/deliveries/:deliveryId/issue',
                element: <DeliveryPrintPage mode="issue" />,
              },
            ],
          },
          {
            element: (
              <RoleRoute
                roles={['ADMIN', 'WAREHOUSE', 'SALE_B2B', 'STORE_STAFF', 'FRANCHISE_STAFF']}
              />
            ),
            children: [
              { path: ROUTES.deliveries, element: <DeliveryBoardPage /> },
              { path: '/deliveries/:deliveryId/print', element: <DeliveryPrintPage mode="note" /> },
            ],
          },
          {
            element: <PermissionRoute permission="create_order" />,
            children: [
              { path: ROUTES.customers, element: <CustomerListPage /> },
              { path: ROUTES.orders, element: <OrderListPage /> },
              { path: ROUTES.orderNew, element: <OrderFormPage /> },
              { path: '/orders/:orderId', element: <OrderDetailPage /> },
              { path: '/orders/:orderId/edit', element: <OrderFormPage /> },
              { path: '/orders/:orderId/print', element: <OrderPrintPage /> },
            ],
          },
          {
            element: <PermissionRoute permission="manage_master_data" />,
            children: [
              { path: ROUTES.admin.locations, element: <LocationsPage /> },
              { path: ROUTES.admin.salesChannels, element: <SalesChannelsPage /> },
              { path: ROUTES.admin.leadSources, element: <LeadSourcesPage /> },
              { path: ROUTES.admin.products, element: <ProductsPage /> },
              { path: ROUTES.admin.commissionRules, element: <CommissionRulesPage /> },
              { path: ROUTES.admin.safetyStock, element: <SafetyStockPage /> },
              { path: ROUTES.admin.settings, element: <SettingsPage /> },
            ],
          },
        ],
      },
    ],
  },
])
