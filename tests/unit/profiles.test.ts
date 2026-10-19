import { describe, expect, it, vi } from 'vitest'
import { createProfileDefaultsService, defaultsPayload } from '@/services/profiles.service'
import type { AppSupabaseClient } from '@/lib/supabase'
describe('profile default mutation boundary', () => {
  const empty = {
    default_location_id: null,
    default_sales_channel_id: null,
    default_lead_source_id: null,
  }
  it('clears nullable defaults without accepting extra privileged fields', () => {
    expect(
      defaultsPayload({ ...empty, role_id: 'admin', is_active: false } as typeof empty),
    ).toEqual(empty)
  })
  it('rejects malformed defaults and user identity before contacting the database', async () => {
    const from = vi.fn()
    const service = createProfileDefaultsService({ from } as unknown as AppSupabaseClient)
    await expect(service.save('bad', empty)).rejects.toThrow('Người dùng')
    await expect(
      service.save('00000000-0000-0000-0000-000000000001', {
        ...empty,
        default_location_id: 'bad',
      }),
    ).rejects.toThrow('mặc định')
    expect(from).not.toHaveBeenCalled()
  })
})
