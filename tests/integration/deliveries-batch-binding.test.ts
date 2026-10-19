/* eslint-disable @typescript-eslint/no-explicit-any -- RPC results are dynamic JSON; the tests assert on their shape */
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import type { AppSupabaseClient } from '@/lib/supabase'
import type { Database } from '@/types/database.generated'
import { TEST_PASSWORD, TEST_USERS, getLocalConfig, serviceClient } from './helpers'

/**
 * DEL-011 (review RV-04/RV-05):
 *   RV-04 — the batch/quantity a delivery's issue note shows must match what is actually posted to
 *   the ledger when it is DELIVERED, regardless of the order sibling deliveries are confirmed in, and
 *   reprinting after DELIVERED must keep showing that same recorded fact.
 *   RV-05 — an allocated batch that stops being sellable (deactivated) must block dispatch/deliver
 *   instead of silently shipping from, or crediting, a different physical batch.
 */

async function clientFor(email: string): Promise<AppSupabaseClient> {
  const { url, anonKey } = getLocalConfig()
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD })
  if (error) throw error
  return client
}

const rpc = (client: AppSupabaseClient, fn: string, args: Record<string, unknown> = {}) =>
  (
    client as unknown as {
      rpc: (f: string, a: unknown) => PromiseLike<{ data: any; error: any }>
    }
  ).rpc(fn, args)

let admin: AppSupabaseClient
let sale: AppSupabaseClient
let warehouse: AppSupabaseClient
let customer: string
const svc = () => serviceClient()

beforeAll(async () => {
  ;[admin, sale, warehouse] = await Promise.all([
    clientFor(TEST_USERS.admin),
    clientFor(TEST_USERS.sale),
    clientFor(TEST_USERS.warehouse),
  ])
  const { data } = await svc()
    .from('customers')
    .select('id')
    .eq('phone_normalized', '0900000003')
    .single()
  customer = data?.id as string
})

const act = (client: AppSupabaseClient, id: string, action: string, reason?: string) =>
  rpc(client, 'transition_order', { p_order_id: id, p_action: action, p_reason: reason ?? null })
const step = (client: AppSupabaseClient, id: string, action: string, reason?: string) =>
  rpc(client, 'transition_delivery', {
    p_delivery_id: id,
    p_action: action,
    p_reason: reason ?? null,
  })

function inDays(days: number) {
  return new Date(Date.now() + (days + 1) * 86400000).toISOString().slice(0, 10)
}

interface World {
  productId: string
  locationId: string
  /** Earlier expiry: FEFO takes this one first. */
  batchEarly: string
  batchLate: string
}

/** One product/location with two batches of different expiry, `qty` units each. */
async function world(qty = 10): Promise<World> {
  const tag = randomUUID().slice(0, 6).toUpperCase()
  const { data: product } = await svc()
    .from('products')
    .insert({
      sku: `P-DB-${tag}`,
      name: `Bánh khớp lô ${tag}`,
      list_price: 100000,
      default_commission_rate: 0,
    })
    .select('id')
    .single()
  const { data: location } = await svc()
    .from('locations')
    .insert({ code: `DB-${tag}`, name: `Kho khớp lô ${tag}`, location_type: 'STORE', region: 'HN' })
    .select('id')
    .single()
  const productId = product?.id as string
  const locationId = location?.id as string
  const batches: string[] = []
  for (const expiry of ['2026-12-01', '2027-06-01']) {
    const { data: batch } = await admin
      .from('product_batches')
      .insert({
        batch_code: `B-${randomUUID().slice(0, 6)}`,
        product_id: productId,
        manufactured_date: '2026-09-01',
        expiry_date: expiry,
      })
      .select('id')
      .single()
    const res = await rpc(admin, 'record_opening_stock', {
      p_location_id: locationId,
      p_product_id: productId,
      p_batch_id: batch?.id,
      p_quantity: qty,
    })
    expect(res.error).toBeNull()
    batches.push(batch?.id as string)
  }
  return {
    productId,
    locationId,
    batchEarly: batches[0] as string,
    batchLate: batches[1] as string,
  }
}

/** A confirmed, fully allocated order (RESERVED) at `w`. */
async function reservedOrder(w: World, qty: number) {
  const { data, error } = await rpc(sale, 'save_draft_order', {
    p_order_id: null,
    p_customer_id: customer,
    p_items: [{ product_id: w.productId, quantity: qty }],
    p_discount_amount: 0,
    p_creation_location_id: w.locationId,
  })
  expect(error).toBeNull()
  expect((await act(sale, data.id, 'submit')).error).toBeNull()
  expect((await act(admin, data.id, 'confirm')).error).toBeNull()
  // Deposit rules are covered by the payment tests: stand in with the allowed jump to CONFIRMED.
  await svc().from('orders').update({ status: 'CONFIRMED' }).eq('id', data.id)
  expect((await rpc(admin, 'allocate_order', { p_order_id: data.id })).error).toBeNull()
  const { data: items } = await svc().from('order_items').select('id').eq('order_id', data.id)
  return { id: data.id as string, itemId: items?.[0]?.id as string }
}

type Order = Awaited<ReturnType<typeof reservedOrder>>

const plan = (order: Order, qty: number, w: World) =>
  rpc(sale, 'save_delivery', {
    p_delivery_id: null,
    p_order_id: order.id,
    p_scheduled_date: inDays(1),
    p_items: [{ order_item_id: order.itemId, quantity: qty }],
    p_delivery_address: '12 Phố Huế, Hà Nội',
    p_source_location_id: w.locationId,
  })

/** ready -> dispatch (the test asserts on dispatch's own result, so it is returned, not checked here). */
async function goOut(id: string) {
  expect((await step(warehouse, id, 'ready')).error).toBeNull()
  return step(warehouse, id, 'dispatch')
}

/**
 * Both delivery_item_batches.created_at and inventory_movements.created_at default to now(), which
 * is frozen for the whole transaction in Postgres: several rows written within the same
 * dispatch/deliver call get an identical timestamp, so ordering by created_at alone is not
 * deterministic. Sort by the batch's own FEFO key (expiry, earliest first) instead, which is what
 * the SQL itself now orders by (and what these tests care about).
 */
const expiryRank = (w: World, batchId: string) => (batchId === w.batchEarly ? 0 : 1)
const byExpiry = (w: World) => (a: { batchId: string }, b: { batchId: string }) =>
  expiryRank(w, a.batchId) - expiryRank(w, b.batchId)

/** The batches actually bound to a delivery at dispatch, in FEFO order. */
const boundBatches = async (w: World, deliveryId: string) => {
  const { data: items } = await svc()
    .from('delivery_items')
    .select('id')
    .eq('delivery_id', deliveryId)
  const ids = (items ?? []).map((i) => i.id)
  if (ids.length === 0) return []
  const { data } = await svc()
    .from('delivery_item_batches')
    .select('batch_id, quantity')
    .in('delivery_item_id', ids)
  return (data ?? [])
    .map((r) => ({ batchId: r.batch_id as string, quantity: r.quantity as number }))
    .sort(byExpiry(w))
}

/** The SALE_OUT movements actually posted for a delivery, in the same shape as boundBatches(). */
const soldBatches = async (w: World, deliveryId: string) => {
  const { data } = await svc()
    .from('inventory_movements')
    .select('batch_id, quantity')
    .eq('delivery_id', deliveryId)
    .eq('movement_type', 'SALE_OUT')
  return (data ?? [])
    .map((r) => ({ batchId: r.batch_id as string, quantity: r.quantity as number }))
    .sort(byExpiry(w))
}

const pickOf = async (client: AppSupabaseClient, id: string) =>
  (await rpc(client, 'delivery_detail', { p_delivery_id: id })).data.items[0].pick as {
    batch_code: string
    expiry_date: string
    quantity: number
  }[]

const balanceOf = async (locationId: string, batchId: string) =>
  (
    await svc()
      .from('inventory_balances')
      .select('available_qty, reserved_qty')
      .eq('location_id', locationId)
      .eq('batch_id', batchId)
      .single()
  ).data

// Rollback-only upgrade/clock fixtures on the project's Docker LOCAL database. These tests never
// change migration history or clock functions permanently and never connect to a linked project.
function localSql(sql: string) {
  getLocalConfig() // Refuse non-local API configuration before invoking any fixture SQL.
  const projectId = readFileSync('supabase/config.toml', 'utf8').match(
    /^project_id = "([a-z0-9_-]+)"/m,
  )?.[1]
  if (!projectId) throw new Error('Missing safe local Supabase project id')
  return spawnSync(
    'docker',
    [
      'exec',
      '-i',
      `supabase_db_${projectId}`,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    {
      input: `BEGIN;\n${sql}\nROLLBACK;\n`,
      encoding: 'utf8',
      timeout: 30_000,
    },
  )
}

const migrationSection = (name: string) => {
  const source = readFileSync(
    'supabase/migrations/20261002070000_delivery_batch_binding.sql',
    'utf8',
  )
  return (
    source.split(`-- BEGIN ${name}\n`)[1]?.split(`-- END ${name}`)[0] ??
    source.split(`-- BEGIN ${name}\r\n`)[1]?.split(`-- END ${name}`)[0]
  )
}

describe('batch binding at dispatch matches the ledger regardless of delivery order (DEL-011, RV-04)', () => {
  it('delivering the later-created sibling first still follows FEFO; both notes stay stable after DELIVERED', async () => {
    const w = await world(10) // 10 @ 2026-12-01 (early), 10 @ 2027-06-01 (late)
    const order = await reservedOrder(w, 15) // allocated: 10 from early + 5 from late
    const a = await plan(order, 10, w) // created first
    const b = await plan(order, 5, w) // created second

    // B goes out (and is delivered) before A. Nothing is in logistics yet for this line/source, so
    // the real FEFO queue gives B the earliest-expiry batch — not a guess based on creation order.
    expect((await goOut(b.data.id)).error).toBeNull()
    const bBound = await boundBatches(w, b.data.id)
    expect(bBound).toEqual([{ batchId: w.batchEarly, quantity: 5 }])

    expect((await step(warehouse, b.data.id, 'deliver')).error).toBeNull()
    expect(await soldBatches(w, b.data.id)).toEqual(bBound)
    // Reprint after DELIVERED: the recorded fact, not a recomputed (and possibly different) slice.
    expect(await pickOf(warehouse, b.data.id)).toEqual([
      expect.objectContaining({ quantity: 5, expiry_date: '2026-12-01' }),
    ])

    // A dispatches after B: the offset is B's real bound quantity, so A gets the rest of the early
    // batch plus the late one — never the units B already has.
    expect((await goOut(a.data.id)).error).toBeNull()
    const aBound = await boundBatches(w, a.data.id)
    expect(aBound).toEqual([
      { batchId: w.batchEarly, quantity: 5 },
      { batchId: w.batchLate, quantity: 5 },
    ])
    expect((await step(warehouse, a.data.id, 'deliver')).error).toBeNull()
    expect(await soldBatches(w, a.data.id)).toEqual(aBound)
    expect(await pickOf(warehouse, a.data.id)).toEqual([
      expect.objectContaining({ quantity: 5, expiry_date: '2026-12-01' }),
      expect.objectContaining({ quantity: 5, expiry_date: '2027-06-01' }),
    ])

    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })

  it('a not-yet-dispatched sibling keeps the live preview; it only becomes a recorded fact at dispatch', async () => {
    const w = await world(10)
    const order = await reservedOrder(w, 10)
    const d = await plan(order, 10, w)
    // Still PREPARING: delivery_detail shows a live preview, no binding exists yet.
    expect(await pickOf(sale, d.data.id)).toEqual([
      expect.objectContaining({ quantity: 10, expiry_date: '2026-12-01' }),
    ])
    expect(await boundBatches(w, d.data.id)).toEqual([])
    expect((await goOut(d.data.id)).error).toBeNull()
    expect(await boundBatches(w, d.data.id)).toEqual([{ batchId: w.batchEarly, quantity: 10 }])
  })

  it('FAILED -> reschedule -> redispatch -> deliver keeps the original binding, consumed exactly once', async () => {
    const w = await world(10)
    const order = await reservedOrder(w, 5)
    const a = await plan(order, 5, w)
    expect((await goOut(a.data.id)).error).toBeNull()
    const boundAtDispatch = await boundBatches(w, a.data.id)
    expect(boundAtDispatch).toEqual([{ batchId: w.batchEarly, quantity: 5 }])

    expect((await step(warehouse, a.data.id, 'fail', 'Khách vắng nhà')).error).toBeNull()
    expect(
      (
        await rpc(warehouse, 'reschedule_delivery', {
          p_delivery_id: a.data.id,
          p_scheduled_date: inDays(3),
        })
      ).error,
    ).toBeNull()
    expect((await step(warehouse, a.data.id, 'dispatch')).error).toBeNull()
    // Redispatch does not re-pick: the binding from the first dispatch is untouched.
    expect(await boundBatches(w, a.data.id)).toEqual(boundAtDispatch)

    expect((await step(warehouse, a.data.id, 'deliver')).error).toBeNull()
    expect(await soldBatches(w, a.data.id)).toEqual(boundAtDispatch)
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })
})

describe('an allocated batch that stops being sellable blocks dispatch/deliver instead of a silent swap (DEL-011, RV-05)', () => {
  it('rejects dispatch once the allocated batch is deactivated; inventory and the delivery are unchanged', async () => {
    const w = await world(5) // exactly 5 @ early, so the whole line is allocated from that one batch
    const order = await reservedOrder(w, 5)
    const d = await plan(order, 5, w)
    expect((await step(warehouse, d.data.id, 'ready')).error).toBeNull()

    expect(
      (await admin.from('product_batches').update({ status: 'INACTIVE' }).eq('id', w.batchEarly))
        .error,
    ).toBeNull()

    const before = await balanceOf(w.locationId, w.batchEarly)
    const dispatch = await step(warehouse, d.data.id, 'dispatch')
    expect(dispatch.error?.message).toMatch(/ngừng dùng/)

    expect(await balanceOf(w.locationId, w.batchEarly)).toEqual(before)
    expect(await boundBatches(w, d.data.id)).toEqual([])
    const { data: row } = await svc()
      .from('deliveries')
      .select('status, dispatched_at')
      .eq('id', d.data.id)
      .single()
    expect(row).toMatchObject({ status: 'READY', dispatched_at: null })
  })

  it('rejects deliver when the already-dispatched batch is deactivated afterwards; no movement is posted', async () => {
    const w = await world(5)
    const order = await reservedOrder(w, 5)
    const d = await plan(order, 5, w)
    expect((await goOut(d.data.id)).error).toBeNull() // bound while the batch was still ACTIVE

    expect(
      (await admin.from('product_batches').update({ status: 'INACTIVE' }).eq('id', w.batchEarly))
        .error,
    ).toBeNull()

    const deliver = await step(warehouse, d.data.id, 'deliver')
    expect(deliver.error?.message).toMatch(/ngừng dùng/)
    expect(await soldBatches(w, d.data.id)).toEqual([])
    const { data: row } = await svc()
      .from('deliveries')
      .select('status')
      .eq('id', d.data.id)
      .single()
    expect(row?.status).toBe('OUT_FOR_DELIVERY')
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])

    // The existing, unmodified remedy (no new release/re-pick workflow was added): once the batch is
    // sellable again, the same bound units can be delivered.
    expect(
      (await admin.from('product_batches').update({ status: 'ACTIVE' }).eq('id', w.batchEarly))
        .error,
    ).toBeNull()
    expect((await step(warehouse, d.data.id, 'deliver')).error).toBeNull()
  })

  it('cannot be bypassed by writing delivery_item_batches directly, even with the service role', async () => {
    const w = await world(5)
    const order = await reservedOrder(w, 5)
    const d = await plan(order, 5, w)
    const { data: items } = await svc()
      .from('delivery_items')
      .select('id')
      .eq('delivery_id', d.data.id)
    const direct = await svc()
      .from('delivery_item_batches')
      .insert({ delivery_item_id: items?.[0]?.id, batch_id: w.batchEarly, quantity: 5 })
    expect(direct.error?.message).toMatch(/Chỉ hệ thống/)
  })
})

describe('DEL-011 upgrade, redispatch, concurrency and access regressions', () => {
  it('blocks ambiguous historical in-flight upgrades before RPC replacement', async () => {
    const w = await world(5)
    const order = await reservedOrder(w, 5)
    const d = await plan(order, 5, w)
    expect((await goOut(d.data.id)).error).toBeNull()
    const preflight = migrationSection('UPGRADE PREFLIGHT')
    expect(preflight).toBeTruthy()
    const result = localSql(preflight as string)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('historical dispatched deliveries remain in logistics')
    expect(await boundBatches(w, d.data.id)).toEqual([{ batchId: w.batchEarly, quantity: 5 }])
    expect((await step(warehouse, d.data.id, 'deliver')).error).toBeNull()
  })

  it('restores completed historical batches from SALE_OUT evidence without guessing FEFO', async () => {
    const w = await world(5)
    const order = await reservedOrder(w, 5)
    const d = await plan(order, 5, w)
    expect((await goOut(d.data.id)).error).toBeNull()
    expect((await step(warehouse, d.data.id, 'deliver')).error).toBeNull()
    const result = localSql(`
      ALTER TABLE public.delivery_item_batches DISABLE TRIGGER delivery_item_batches_guard_write;
      DELETE FROM public.delivery_item_batches;
      ALTER TABLE public.delivery_item_batches ENABLE TRIGGER delivery_item_batches_guard_write;
      ${migrationSection('COMPLETED HISTORY BACKFILL')}
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM public.delivery_item_batches dib JOIN public.delivery_items di ON di.id=dib.delivery_item_id
          WHERE di.delivery_id='${d.data.id}' AND dib.batch_id='${w.batchEarly}' AND dib.quantity=5) THEN
          RAISE EXCEPTION 'Completed ledger backfill did not restore the original batch';
        END IF;
      END $$;
    `)
    expect(result.status, result.stderr).toBe(0)
    expect(await soldBatches(w, d.data.id)).toEqual(await boundBatches(w, d.data.id))
  })

  it('refuses completed-history quantity mismatches before binding/RPC changes', async () => {
    const w = await world(5)
    const order = await reservedOrder(w, 5)
    const d = await plan(order, 5, w)
    expect((await goOut(d.data.id)).error).toBeNull()
    expect((await step(warehouse, d.data.id, 'deliver')).error).toBeNull()
    // A rollback-only historical upgrade fixture: hide unrelated local in-flight fixtures from
    // the first preflight, then simulate a corrupt completed line without modifying its ledger.
    const result = localSql(`
      ALTER TABLE public.deliveries DISABLE TRIGGER USER;
      UPDATE public.deliveries SET status='CANCELLED', cancelled_reason='rollback-only upgrade fixture'
        WHERE dispatched_at IS NOT NULL AND status NOT IN ('DELIVERED', 'CANCELLED');
      ALTER TABLE public.deliveries ENABLE TRIGGER USER;
      ALTER TABLE public.delivery_items DISABLE TRIGGER USER;
      UPDATE public.delivery_items SET quantity=quantity+1 WHERE delivery_id='${d.data.id}';
      ALTER TABLE public.delivery_items ENABLE TRIGGER USER;
      ${migrationSection('UPGRADE PREFLIGHT')}
    `)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(
      'completed delivery quantities do not match their SALE_OUT ledger',
    )
    expect(await soldBatches(w, d.data.id)).toEqual([{ batchId: w.batchEarly, quantity: 5 }])
    expect(
      (await svc().from('delivery_items').select('quantity').eq('delivery_id', d.data.id).single())
        .data?.quantity,
    ).toBe(5)
  })

  it('rejects inactive original batches on redispatch without changing the logistics binding', async () => {
    const w = await world(5)
    const order = await reservedOrder(w, 5)
    const d = await plan(order, 5, w)
    expect((await goOut(d.data.id)).error).toBeNull()
    expect((await step(warehouse, d.data.id, 'fail', 'Khách vắng nhà')).error).toBeNull()
    expect(
      (
        await rpc(warehouse, 'reschedule_delivery', {
          p_delivery_id: d.data.id,
          p_scheduled_date: inDays(3),
        })
      ).error,
    ).toBeNull()
    expect(
      (await admin.from('product_batches').update({ status: 'INACTIVE' }).eq('id', w.batchEarly))
        .error,
    ).toBeNull()
    const before = await balanceOf(w.locationId, w.batchEarly)
    expect((await step(warehouse, d.data.id, 'dispatch')).error?.message).toMatch(/ngừng dùng/)
    expect(await boundBatches(w, d.data.id)).toEqual([{ batchId: w.batchEarly, quantity: 5 }])
    expect(await balanceOf(w.locationId, w.batchEarly)).toEqual(before)
    expect(
      (await svc().from('deliveries').select('status').eq('id', d.data.id).single()).data?.status,
    ).toBe('READY')
    // Leave no unresolved logistics fixture for the migration-preflight tests which follow.
    expect(
      (await admin.from('product_batches').update({ status: 'ACTIVE' }).eq('id', w.batchEarly))
        .error,
    ).toBeNull()
    expect((await step(warehouse, d.data.id, 'dispatch')).error).toBeNull()
    expect((await step(warehouse, d.data.id, 'deliver')).error).toBeNull()
  })

  it('rejects expired original batches on redispatch in a rollback-only clock fixture', async () => {
    const w = await world(5)
    const order = await reservedOrder(w, 5)
    const d = await plan(order, 5, w)
    expect((await goOut(d.data.id)).error).toBeNull()
    expect((await step(warehouse, d.data.id, 'fail', 'Đổi ngày giao')).error).toBeNull()
    expect(
      (
        await rpc(warehouse, 'reschedule_delivery', {
          p_delivery_id: d.data.id,
          p_scheduled_date: inDays(3),
        })
      ).error,
    ).toBeNull()
    const userId = (await warehouse.auth.getUser()).data.user?.id
    expect(userId).toBeTruthy()
    const result = localSql(`
      CREATE OR REPLACE FUNCTION private.business_today() RETURNS date LANGUAGE sql STABLE SET search_path='' AS $$ SELECT DATE '2026-12-02' $$;
      SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
      DO $$ BEGIN
        BEGIN
          PERFORM public.transition_delivery('${d.data.id}', 'dispatch');
          RAISE EXCEPTION 'Expected expired original batch rejection';
        EXCEPTION WHEN OTHERS THEN
          IF SQLERRM NOT LIKE '%hết hạn sử dụng%' THEN RAISE; END IF;
        END;
        IF (SELECT status FROM public.deliveries WHERE id='${d.data.id}') <> 'READY' THEN
          RAISE EXCEPTION 'Redispatch status changed despite expired batch';
        END IF;
      END $$;
    `)
    expect(result.status, result.stderr).toBe(0)
    expect(await boundBatches(w, d.data.id)).toEqual([{ batchId: w.batchEarly, quantity: 5 }])
    expect(await soldBatches(w, d.data.id)).toEqual([])
    expect((await step(warehouse, d.data.id, 'dispatch')).error).toBeNull()
    expect((await step(warehouse, d.data.id, 'deliver')).error).toBeNull()
  })

  it('concurrent siblings bind distinct batch quantities and can deliver in reverse order', async () => {
    const w = await world(5)
    const order = await reservedOrder(w, 10)
    const a = await plan(order, 5, w)
    const b = await plan(order, 5, w)
    for (const d of [a, b]) expect((await step(warehouse, d.data.id, 'ready')).error).toBeNull()
    const dispatched = await Promise.all([
      step(warehouse, a.data.id, 'dispatch'),
      step(warehouse, b.data.id, 'dispatch'),
    ])
    expect(dispatched.map((r) => r.error)).toEqual([null, null])
    const bindings = [await boundBatches(w, a.data.id), await boundBatches(w, b.data.id)]
    expect(
      bindings
        .flat()
        .map((r) => r.batchId)
        .sort(),
    ).toEqual([w.batchEarly, w.batchLate].sort())
    expect(bindings.flat().map((r) => r.quantity)).toEqual([5, 5])
    for (const d of [b, a]) expect((await step(warehouse, d.data.id, 'deliver')).error).toBeNull()
    expect(await soldBatches(w, a.data.id)).toEqual(bindings[0])
    expect(await soldBatches(w, b.data.id)).toEqual(bindings[1])
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })

  it('binding rows follow delivery RLS and authenticated clients cannot mutate them', async () => {
    const w = await world(5)
    const order = await reservedOrder(w, 5)
    const d = await plan(order, 5, w)
    expect((await goOut(d.data.id)).error).toBeNull()
    const itemId = (
      await svc().from('delivery_items').select('id').eq('delivery_id', d.data.id).single()
    ).data?.id as string
    for (const client of [sale, warehouse, admin]) {
      const visible = await client
        .from('delivery_item_batches')
        .select('id')
        .eq('delivery_item_id', itemId)
      expect(visible.error).toBeNull()
      expect(visible.data).toHaveLength(1)
    }
    const unrelated = await clientFor(TEST_USERS.store)
    expect(
      (await unrelated.from('delivery_item_batches').select('id').eq('delivery_item_id', itemId))
        .data,
    ).toEqual([])
    expect(
      (
        await sale
          .from('delivery_item_batches')
          .insert({ delivery_item_id: itemId, batch_id: w.batchLate, quantity: 1 })
      ).error,
    ).not.toBeNull()
    expect((await step(warehouse, d.data.id, 'deliver')).error).toBeNull()
  })
})
