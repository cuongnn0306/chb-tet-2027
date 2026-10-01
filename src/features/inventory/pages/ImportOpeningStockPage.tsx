import { useMutation } from '@tanstack/react-query'
import { useState, type ChangeEvent } from 'react'
import { Link } from 'react-router'
import { ROUTES } from '@/app/routes'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { TextAreaField } from '@/components/ui/fields'
import {
  IMPORT_HEADER,
  IMPORT_TEMPLATE,
  parseOpeningStockText,
  type ParsedImport,
} from '@/domain/inventory/opening-stock-import'
import { formatDate } from '@/lib/date'
import { describeDbError } from '@/lib/db-errors'
import type { ImportReport } from '@/services/inventory.service'
import { useInventoryService } from '../hooks/useInventoryService'

interface Checked {
  parsed: ParsedImport
  report: ImportReport | null
}

/** INV-006 (Admin): validate first (nothing is written), then import the whole file or nothing. */
export function ImportOpeningStockPage() {
  const service = useInventoryService()
  const [text, setText] = useState('')
  const [checked, setChecked] = useState<Checked | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<ImportReport | null>(null)

  const check = useMutation({
    mutationFn: async (): Promise<Checked> => {
      const parsed = parseOpeningStockText(text)
      if (parsed.issues.length > 0 || parsed.rows.length === 0) return { parsed, report: null }
      return { parsed, report: await service.importOpeningStock(parsed.rows, true) }
    },
    onSuccess: (result) => {
      setChecked(result)
      setDone(null)
    },
  })

  const apply = useMutation({
    mutationFn: () => service.importOpeningStock((checked as Checked).parsed.rows, false),
    onSuccess: (report) => {
      setConfirming(false)
      if (report.ok) {
        setDone(report)
        setChecked(null)
        setText('')
      } else {
        // The data changed since the check (e.g. a batch was created meanwhile): show the new problems.
        setChecked((current) => (current ? { ...current, report } : current))
      }
    },
  })

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setText(await file.text())
    setChecked(null)
    setDone(null)
    event.target.value = ''
  }

  function downloadTemplate() {
    const blob = new Blob(['﻿' + IMPORT_TEMPLATE], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'mau-nhap-ton-dau-ky.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const report = checked?.report ?? null
  const ready =
    checked && checked.parsed.issues.length === 0 && report?.ok === true && report.dry_run

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Nhập tồn đầu kỳ</h1>
        <p className="text-sm text-slate-600">
          Dán trực tiếp từ Excel hoặc chọn file CSV với các cột:{' '}
          <strong>{IMPORT_HEADER.join(' | ')}</strong>. Ngày nhập theo dd/MM/yyyy. Hệ thống kiểm tra
          toàn bộ file trước; có lỗi ở bất kỳ dòng nào thì không nhập dòng nào.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={downloadTemplate}>
          Tải file mẫu (CSV)
        </Button>
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-slate-300 bg-white px-4 text-slate-800 hover:bg-slate-50">
          Chọn file CSV
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            className="sr-only"
            onChange={(e) => void handleFile(e)}
          />
        </label>
      </div>

      <TextAreaField
        label="Dữ liệu tồn đầu kỳ"
        rows={10}
        value={text}
        placeholder={`${IMPORT_HEADER.join('\t')}\nHN-BEP\tTT-1200\tB-2027-01\t01/01/2027\t01/03/2027\t100`}
        onChange={(e) => {
          setText(e.target.value)
          setChecked(null)
        }}
      />
      <div>
        <Button
          loading={check.isPending}
          disabled={text.trim() === ''}
          onClick={() => check.mutate()}
        >
          Kiểm tra dữ liệu
        </Button>
      </div>

      {check.isError ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {describeDbError(check.error as { code?: string; message?: string })}
        </p>
      ) : null}

      {done && done.ok && !done.dry_run ? (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">
          Đã nhập {done.rows} dòng, tạo {done.batches_created} lô mới, tổng{' '}
          {done.total_quantity.toLocaleString('vi-VN')} cái.{' '}
          <Link className="underline" to={ROUTES.inventoryBatches}>
            Xem tồn theo lô
          </Link>
        </p>
      ) : null}

      {checked && checked.parsed.issues.length > 0 ? (
        <IssueList
          title={`Có ${checked.parsed.issues.length} dòng chưa đọc được trong file`}
          items={checked.parsed.issues.map((i) => `Dòng ${i.line}: ${i.message}`)}
        />
      ) : null}

      {report && !report.ok ? (
        <IssueList
          title={`Máy chủ phát hiện ${report.error_count} lỗi${report.error_count > report.errors.length ? ` (hiển thị ${report.errors.length} lỗi đầu)` : ''}`}
          items={report.errors.map(
            (e) => `Dòng ${checked?.parsed.lines[e.row - 1] ?? e.row}: ${e.message}`,
          )}
        />
      ) : null}

      {ready && report?.ok && report.dry_run ? (
        <div className="flex flex-col gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="font-medium text-green-900">
            Dữ liệu hợp lệ: {report.rows} dòng, {report.batches_to_create} lô mới, tổng{' '}
            {report.total_quantity.toLocaleString('vi-VN')} cái.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-600">
                <tr>
                  {IMPORT_HEADER.map((h) => (
                    <th key={h} className="pr-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {checked.parsed.rows.slice(0, 10).map((row, i) => (
                  <tr key={i} className="border-t border-green-100">
                    <td className="pr-3 font-mono">{row.location_code}</td>
                    <td className="pr-3 font-mono">{row.sku}</td>
                    <td className="pr-3 font-mono">{row.batch_code}</td>
                    <td className="pr-3">{formatDate(row.manufactured_date)}</td>
                    <td className="pr-3">{formatDate(row.expiry_date)}</td>
                    <td className="pr-3 tabular-nums">{row.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {checked.parsed.rows.length > 10 ? (
              <p className="mt-1 text-xs text-slate-600">
                … và {checked.parsed.rows.length - 10} dòng khác.
              </p>
            ) : null}
          </div>
          <div>
            <Button onClick={() => setConfirming(true)}>Nhập vào kho</Button>
          </div>
        </div>
      ) : null}

      <Dialog open={confirming} title="Nhập tồn đầu kỳ" onClose={() => setConfirming(false)}>
        {confirming && ready && report?.ok && report.dry_run ? (
          <div className="flex flex-col gap-4">
            <p className="text-slate-800">
              Nhập {report.rows} dòng ({report.total_quantity.toLocaleString('vi-VN')} cái) và tạo{' '}
              {report.batches_to_create} lô mới? Mỗi dòng tạo một dòng điều chỉnh trong sổ kho và
              được lưu Audit Log. Sổ kho không sửa/xóa được; nếu nhập sai, hãy dùng điều chỉnh tồn
              kèm lý do.
            </p>
            {apply.isError ? (
              <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
                {describeDbError(apply.error as { code?: string; message?: string })}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Quay lại
              </Button>
              <Button loading={apply.isPending} onClick={() => apply.mutate()}>
                Nhập vào kho
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </section>
  )
}

function IssueList({ title, items }: { title: string; items: string[] }) {
  return (
    <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
      <p className="font-medium">{title}. Chưa nhập gì vào kho.</p>
      <ul className="mt-1 list-disc pl-5">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  )
}
