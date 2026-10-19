import { useEffect } from 'react'
import { getSupabase } from '@/lib/supabase'

/**
 * PAY-009: live updates of one order. Subscribes to changes of the order and its payments
 * (RLS decides what this user may receive) and calls `onChange` so the screen refreshes without a reload.
 */
export function useOrderRealtime(orderId: string, onChange: (source: 'order' | 'payment') => void) {
  useEffect(() => {
    if (!orderId) return
    const client = getSupabase()
    const channel = client
      .channel(`order-live-${orderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments', filter: `order_id=eq.${orderId}` },
        () => onChange('payment'),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        () => onChange('order'),
      )
      .subscribe()
    return () => {
      void client.removeChannel(channel)
    }
    // onChange is expected to be stable enough for a subscription; re-subscribing per render would drop events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])
}
