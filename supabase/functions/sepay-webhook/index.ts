// Edge Function: SePay payment webhook (PAY-007).
//
// Thin, trusted adapter: authenticate the request, parse it, hand it to the database function
// process_sepay_webhook() (idempotent, all business rules live there) and answer SePay.
//
// Secrets (set with `supabase secrets set`, never committed, never VITE_*):
//   SEPAY_WEBHOOK_API_KEY       expected value of "Authorization: Apikey <key>"
//   SEPAY_WEBHOOK_HMAC_SECRET   optional HMAC-SHA256 secret over the raw body
//   SEPAY_SIGNATURE_HEADER      header carrying the signature (default: x-sepay-signature)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the Edge Function runtime.
//
// Responses: 200 {"success":true} when the event was handled (including duplicates and events that
// need review: those are stored, retrying would change nothing); 400 for an unusable payload;
// 401 when authentication fails; 500 for a temporary failure so SePay retries.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { authenticateWebhook } from '../_shared/webhook-auth.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405)

  const rawBody = await request.text()
  const signatureHeader = (
    Deno.env.get('SEPAY_SIGNATURE_HEADER') ?? 'x-sepay-signature'
  ).toLowerCase()

  const auth = await authenticateWebhook(
    {
      authorization: request.headers.get('authorization'),
      signature: request.headers.get(signatureHeader),
      rawBody,
    },
    {
      apiKey: Deno.env.get('SEPAY_WEBHOOK_API_KEY'),
      hmacSecret: Deno.env.get('SEPAY_WEBHOOK_HMAC_SECRET'),
    },
  )
  if (!auth.ok) {
    // Log the reason only: never the headers, the key or the payload.
    console.warn(`sepay-webhook: unauthorized (${auth.reason})`)
    return json({ success: false, error: 'unauthorized' }, 401)
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return json({ success: false, error: 'invalid_json' }, 400)
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return json({ success: false, error: 'invalid_payload' }, 400)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { data, error } = await supabase.rpc('process_sepay_webhook', { p_payload: payload })
  if (error) {
    console.error(`sepay-webhook: processing failed (${error.code ?? 'unknown'})`)
    // P0001 = our own validation (e.g. missing transaction id): retrying cannot fix it.
    return json({ success: false, error: 'rejected' }, error.code === 'P0001' ? 400 : 500)
  }
  return json({ success: true, status: (data as { status?: string } | null)?.status ?? null })
})
