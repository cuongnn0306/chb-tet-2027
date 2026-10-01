import type { CustomerFields } from '@/domain/customers/validation'
import type { AppSupabaseClient } from '@/lib/supabase'
import type { Database } from '@/types/database.generated'
import { DbError } from './crud.service'

export type Customer = Database['public']['Tables']['customers']['Row']

export interface CustomerSearch {
  query?: string
  customerType?: 'INDIVIDUAL' | 'COMPANY' | null
  includeArchived?: boolean
  limit?: number
  offset?: number
}

export const CUSTOMER_PAGE_SIZE = 25

/** CUS-005: purchase history of a customer (orders past draft, not cancelled/voided). */
export interface CustomerHistory {
  orderCount: number
  totalGross: number
  lastOrderAt: string | null
}

const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim())

/** Form fields -> columns. Fields of the other customer type are cleared so data stays consistent. */
export function customerToPayload(fields: CustomerFields) {
  const company = fields.customerType === 'COMPANY'
  return {
    customer_type: fields.customerType,
    name: company ? null : blankToNull(fields.name),
    phone: blankToNull(fields.phone),
    address: company ? null : blankToNull(fields.address),
    company_name: company ? blankToNull(fields.companyName) : null,
    tax_code: company ? blankToNull(fields.taxCode) : null,
    contact_name: company ? blankToNull(fields.contactName) : null,
    contact_title: company ? blankToNull(fields.contactTitle) : null,
    email: company ? blankToNull(fields.email) : null,
    company_address: company ? blankToNull(fields.companyAddress) : null,
  }
}

export function createCustomerService(client: AppSupabaseClient) {
  return {
    /** CUS-006: accent-insensitive search over name, company, contact, tax code, email and phone. */
    async search(params: CustomerSearch = {}): Promise<Customer[]> {
      const { data, error } = await client.rpc('search_customers', {
        p_query: params.query ?? '',
        p_customer_type: params.customerType ?? undefined,
        p_include_archived: params.includeArchived ?? false,
        p_limit: params.limit ?? CUSTOMER_PAGE_SIZE,
        p_offset: params.offset ?? 0,
      })
      if (error) throw new DbError(error)
      return data ?? []
    },

    /** CUS-004: customers with the same phone (any format) or tax code. Never blocks creation. */
    async findSimilar(params: {
      phone?: string
      taxCode?: string
      excludeId?: string
    }): Promise<Customer[]> {
      const { data, error } = await client.rpc('find_similar_customers', {
        p_phone: params.phone ?? undefined,
        p_tax_code: params.taxCode ?? undefined,
        p_exclude_id: params.excludeId ?? undefined,
      })
      if (error) throw new DbError(error)
      return data ?? []
    },

    /** CUS-005: history for several customers at once. Customers without orders are absent from the map. */
    async orderSummaries(ids: string[]): Promise<Map<string, CustomerHistory>> {
      if (ids.length === 0) return new Map()
      const { data, error } = await client.rpc('customer_order_summary', { p_customer_ids: ids })
      if (error) throw new DbError(error)
      return new Map(
        (data ?? []).map((row) => [
          row.customer_id,
          {
            orderCount: row.order_count,
            totalGross: row.total_gross,
            lastOrderAt: row.last_order_at,
          },
        ]),
      )
    },

    async get(id: string): Promise<Customer | null> {
      const { data, error } = await client.from('customers').select('*').eq('id', id).maybeSingle()
      if (error) throw new DbError(error)
      return data
    },

    /** CUS-002. created_by is stamped by the database from the signed-in user. */
    async create(fields: CustomerFields): Promise<Customer> {
      const { data: auth } = await client.auth.getUser()
      const { data, error } = await client
        .from('customers')
        .insert({ ...customerToPayload(fields), created_by: auth.user?.id ?? '' })
        .select()
        .single()
      if (error) throw new DbError(error)
      return data
    },

    async update(id: string, fields: CustomerFields): Promise<Customer> {
      const { data, error } = await client
        .from('customers')
        .update(customerToPayload(fields))
        .eq('id', id)
        .select()
        .single()
      if (error) throw new DbError(error)
      return data
    },

    /** Customers are archived, never deleted. */
    async setArchived(id: string, archived: boolean): Promise<Customer> {
      const { data, error } = await client
        .from('customers')
        .update({ is_archived: archived })
        .eq('id', id)
        .select()
        .single()
      if (error) throw new DbError(error)
      return data
    },
  }
}

export type CustomerService = ReturnType<typeof createCustomerService>
