## Task ID

<!-- e.g. ORD-005 -->

## Summary

## Checklist

- [ ] Read relevant PRD / Tech Design sections; no new business rules invented
- [ ] DB changes are in `supabase/migrations/` (+ RLS) and `npx supabase db reset` passes
- [ ] Tests added/updated (unit / integration as applicable)
- [ ] `npm run lint`, `typecheck`, `test`, `build` pass
- [ ] Loading / empty / error / no-permission states handled
- [ ] No secrets committed; no `VITE_*` secret
- [ ] Audit added for sensitive actions
- [ ] Mobile checked
