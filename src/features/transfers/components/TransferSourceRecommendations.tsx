import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NoPermissionState,
} from '@/components/shared/PageState'
import { Button } from '@/components/ui/Button'
import {
  resolveRecommendationQuery,
  type RecommendationQuery,
} from '@/domain/transfers/recommendations'
import { canProposeTransfer } from '@/domain/transfers/transfers'
import { useAuth } from '@/features/auth/auth-context'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { describeDbError } from '@/lib/db-errors'
import type { TransferSourceRecommendation } from '@/services/transfers.service'
import { useTransferService } from '../hooks/useTransferService'

interface Props {
  destinationLocationId: string
  productId: string
  /** The quantity box exactly as typed. */
  quantityText: string
  /** The source currently chosen in the form (may be empty or chosen by hand). */
  selectedLocationId: string
  onSelect: (locationId: string) => void
}

const number = new Intl.NumberFormat('vi-VN')

/**
 * TRF-002: ranked source locations for the destination, SKU and quantity typed above (wireframe 09).
 * Advice only: it reserves nothing, approves nothing and moves no stock. It never fills the source by itself and the
 * "Kho xuất hàng" select below stays the manual fallback. Sellable quantities and their order come from the database.
 */
export function TransferSourceRecommendations({
  destinationLocationId,
  productId,
  quantityText,
  selectedLocationId,
  onSelect,
}: Props) {
  const service = useTransferService()
  const { access } = useAuth()

  // While the quantity is still being typed, no list for an older quantity is shown.
  const settledQuantityText = useDebouncedValue(quantityText)
  const settling = settledQuantityText !== quantityText
  const typedQuery = resolveRecommendationQuery(access, {
    destinationLocationId,
    productId,
    quantityText,
  })
  const query = resolveRecommendationQuery(access, {
    destinationLocationId,
    productId,
    quantityText: settledQuantityText,
  })

  // The key carries everything the answer depends on (user, role, destination, SKU, quantity); a response for a
  // different key can never be shown for the current inputs.
  const suggestions = useQuery({
    queryKey: [
      'transfer-source-suggestions',
      query?.userId ?? null,
      query?.roleCode ?? null,
      query?.destinationLocationId ?? null,
      query?.productId ?? null,
      query?.quantity ?? null,
    ],
    queryFn: () =>
      query
        ? service.suggestSources({
            productId: query.productId,
            destinationLocationId: query.destinationLocationId,
            quantity: query.quantity,
          })
        : Promise.resolve([]),
    enabled: query !== null && !settling,
    retry: false,
    gcTime: 0,
  })

  if (access.status !== 'active') return null
  if (!canProposeTransfer(access.user.roleCode)) {
    return (
      <NoPermissionState title="Bạn chưa có quyền xem gợi ý kho xuất">
        Vui lòng liên hệ Admin nếu bạn cần tạo yêu cầu điều chuyển.
      </NoPermissionState>
    )
  }

  return (
    <section
      aria-labelledby="transfer-source-suggestions-title"
      aria-live="polite"
      className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="transfer-source-suggestions-title"
          className="text-base font-semibold text-slate-900"
        >
          Gợi ý kho xuất
        </h2>
        <p className="text-sm text-slate-600">
          Chỉ để tham khảo: gợi ý không giữ hàng, không duyệt và không làm thay đổi tồn kho. Bạn vẫn
          có thể chọn kho khác ở ô &quot;Kho xuất hàng&quot;.
        </p>
      </div>

      <RecommendationBody
        hasInput={typedQuery !== null}
        query={query}
        settling={settling}
        suggestions={suggestions}
        selectedLocationId={selectedLocationId}
        onSelect={onSelect}
      />
    </section>
  )
}

function RecommendationBody({
  hasInput,
  query,
  settling,
  suggestions,
  selectedLocationId,
  onSelect,
}: {
  /** Destination, SKU and the quantity as typed right now are all valid. */
  hasInput: boolean
  /** The same for the debounced quantity: what the list on screen was asked for. */
  query: RecommendationQuery | null
  settling: boolean
  suggestions: UseQueryResult<TransferSourceRecommendation[]>
  selectedLocationId: string
  onSelect: (locationId: string) => void
}) {
  if (!hasInput) {
    return (
      <p className="text-sm text-slate-600">
        Chọn kho nhận, sản phẩm và nhập số lượng để xem gợi ý kho xuất.
      </p>
    )
  }
  if (settling || query === null || suggestions.isFetching || suggestions.isPending) {
    return <LoadingState label="Đang tìm kho xuất phù hợp…" />
  }
  if (suggestions.isError) {
    const code = (suggestions.error as { code?: string }).code
    return (
      <ErrorState
        title="Không tải được gợi ý kho xuất"
        action={{ label: 'Thử lại', onClick: () => void suggestions.refetch() }}
      >
        {code === '42501'
          ? describeDbError({ code })
          : 'Vui lòng kiểm tra kết nối mạng rồi thử lại. Bạn vẫn có thể chọn kho xuất thủ công.'}
      </ErrorState>
    )
  }
  const sources = suggestions.data
  if (sources.length === 0) {
    return (
      <EmptyState title="Chưa có kho nào còn hàng bán được">
        Không kho nào khác đang có sản phẩm này để bán. Bạn vẫn có thể chọn kho xuất thủ công.
      </EmptyState>
    )
  }
  const requested = query.quantity
  return (
    <ul className="flex flex-col gap-2">
      {sources.map((source) => {
        const selected = source.locationId === selectedLocationId
        return (
          <li
            key={source.locationId}
            className={`flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between ${
              selected ? 'border-green-700 bg-green-50' : 'border-slate-200 bg-white'
            }`}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium break-words text-slate-900">
                {source.locationCode} — {source.locationName}
              </span>
              <span className="text-sm text-slate-700">
                Có thể bán: {number.format(source.sellableQty)} ·{' '}
                {source.coversAll
                  ? 'Đủ số lượng yêu cầu'
                  : `Chưa đủ (cần ${number.format(requested)})`}
              </span>
              {source.sameRegion ? (
                <span className="text-sm text-green-800">Cùng khu vực với kho nhận</span>
              ) : source.region ? (
                <span className="text-sm text-slate-600">Khu vực: {source.region}</span>
              ) : null}
            </div>
            <Button
              type="button"
              variant="secondary"
              aria-pressed={selected}
              aria-label={`Chọn kho xuất ${source.locationCode} — ${source.locationName}`}
              className="w-full sm:w-auto"
              onClick={() => onSelect(source.locationId)}
            >
              {selected ? 'Đã chọn' : 'Chọn kho này'}
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
