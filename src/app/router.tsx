import { createBrowserRouter } from 'react-router'
import { LoginPage } from '@/features/auth/pages/LoginPage'
import { HomePage } from '@/features/dashboard/pages/HomePage'
import { CommissionRulesPage } from '@/features/master-data/pages/CommissionRulesPage'
import { LeadSourcesPage } from '@/features/master-data/pages/LeadSourcesPage'
import { LocationsPage } from '@/features/master-data/pages/LocationsPage'
import { ProductsPage } from '@/features/master-data/pages/ProductsPage'
import { SalesChannelsPage } from '@/features/master-data/pages/SalesChannelsPage'
import { AppLayout } from './AppLayout'
import { AuthGuard } from './auth-guard'
import { MasterDataRoute } from './MasterDataRoute'
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
          {
            element: <MasterDataRoute />,
            children: [
              { path: ROUTES.admin.locations, element: <LocationsPage /> },
              { path: ROUTES.admin.salesChannels, element: <SalesChannelsPage /> },
              { path: ROUTES.admin.leadSources, element: <LeadSourcesPage /> },
              { path: ROUTES.admin.products, element: <ProductsPage /> },
              { path: ROUTES.admin.commissionRules, element: <CommissionRulesPage /> },
            ],
          },
        ],
      },
    ],
  },
])
