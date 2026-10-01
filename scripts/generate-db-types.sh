#!/usr/bin/env bash
# Regenerates src/types/database.generated.ts from the LOCAL database. Never edit that file by hand.
set -euo pipefail
npx supabase gen types typescript --local > src/types/database.generated.ts
echo "Đã cập nhật src/types/database.generated.ts"
