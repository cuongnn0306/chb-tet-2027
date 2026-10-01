import { createBrowserRouter } from 'react-router'
import { LoginPage } from '@/features/auth/pages/LoginPage'
import { HomePage } from '@/features/dashboard/pages/HomePage'
import { AppLayout } from './AppLayout'
import { AuthGuard } from './auth-guard'
import { ROUTES } from './routes'

export const router = createBrowserRouter([
  { path: ROUTES.login, element: <LoginPage /> },
  {
    element: <AuthGuard />,
    children: [
      {
        element: <AppLayout />,
        children: [{ path: ROUTES.home, element: <HomePage /> }],
      },
    ],
  },
])
