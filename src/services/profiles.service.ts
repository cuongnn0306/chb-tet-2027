import type { AppSupabaseClient } from '@/lib/supabase'

export interface ProfileDefaults {
  default_location_id: string | null
  default_sales_channel_id: string | null
  default_lead_source_id: string | null
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function defaultsPayload(input: ProfileDefaults): ProfileDefaults {
  const keys = [
    'default_location_id',
    'default_sales_channel_id',
    'default_lead_source_id',
  ] as const
  const result = {} as ProfileDefaults
  for (const key of keys) {
    const value = input[key]
    if (value !== null && (typeof value !== 'string' || !uuid.test(value)))
      throw new Error('Giá trị mặc định không hợp lệ. Vui lòng chọn từ danh sách.')
    result[key] = value
  }
  return result
}
/** Defaults only: never accepts role/status/user creation fields. Database Admin RLS is authoritative. */
export function createProfileDefaultsService(client: AppSupabaseClient) {
  return {
    async list() {
      const { data, error } = await client
        .from('profiles')
        .select('id,full_name,default_location_id,default_sales_channel_id,default_lead_source_id')
        .order('full_name')
        .order('id')
      if (error) throw error
      return data ?? []
    },
    async save(id: string, input: ProfileDefaults) {
      if (!uuid.test(id)) throw new Error('Người dùng không hợp lệ.')
      const payload = defaultsPayload(input)
      const { data, error } = await client
        .from('profiles')
        .update(payload)
        .eq('id', id)
        .select('id')
        .single()
      if (error) throw error
      return data
    },
  }
}
