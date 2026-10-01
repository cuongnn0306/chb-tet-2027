import { appEnv } from '@/lib/env'

export function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-2 p-6">
      <h1 className="text-2xl font-bold text-green-800">CHB Bánh Chưng Tết 2027</h1>
      <p className="text-slate-600">Hệ thống quản lý bán hàng nội bộ.</p>
      <p className="text-sm text-slate-500">Môi trường: {appEnv.appEnv}</p>
    </main>
  )
}
