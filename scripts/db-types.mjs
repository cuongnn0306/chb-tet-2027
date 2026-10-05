import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import ts from 'typescript'

// Same file scripts/generate-db-types.sh writes; only task:finish --generate-types may call this.
export const generatedTypesPath = 'src/types/database.generated.ts'
// LOCAL stack only. Never --linked / --project-id.
export const typesCommand = ['exec', '--', 'supabase', 'gen', 'types', 'typescript', '--local']

const secretPattern =
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\b(?:sb_secret_|sk_live_|ghp_|github_pat_)/
// The only value declaration `supabase gen types` emits: `export const Constants = {...} as const`.
const constantsName = 'Constants'

const isExported = (node) =>
  Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))

/** Pure data only: no calls, identifiers, spreads, computed keys, methods or templates with holes. */
function isLiteralData(node) {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isNumericLiteral(node)
  )
    return true
  if (
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  )
    return true
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(isLiteralData)
  if (ts.isObjectLiteralExpression(node))
    return node.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) ||
          ts.isStringLiteral(property.name) ||
          ts.isNumericLiteral(property.name)) &&
        isLiteralData(property.initializer),
    )
  return false
}

function isConstantsStatement(statement) {
  if (!ts.isVariableStatement(statement)) return false
  const { declarations, flags } = statement.declarationList
  if (!(flags & ts.NodeFlags.Const) || declarations.length !== 1) return false
  const [declaration] = declarations
  if (!ts.isIdentifier(declaration.name) || declaration.name.text !== constantsName) return false
  if (declaration.type || !declaration.initializer) return false
  let value = declaration.initializer
  if (ts.isAsExpression(value)) {
    const { typeName } = value.type
    if (
      !ts.isTypeReferenceNode(value.type) ||
      !ts.isIdentifier(typeName) ||
      typeName.text !== 'const'
    )
      return false
    value = value.expression
  }
  return isLiteralData(value)
}

/**
 * Returns a rejection reason, or null when the CLI output is acceptable as generated types:
 * syntactically valid TypeScript whose top level is only type aliases/interfaces, an exported
 * `Database` type, and the literal `Constants` object. Source text is never echoed in reasons.
 */
export function rejectGeneratedTypes(text) {
  if (typeof text !== 'string' || !text.trim()) return 'Supabase CLI returned empty output.'
  if (text.includes('\0')) return 'Supabase CLI output contains NUL bytes.'
  if (secretPattern.test(text))
    return 'Supabase CLI output contains credential-like text; rejected.'

  const { diagnostics } = ts.transpileModule(text, {
    fileName: 'database.generated.ts',
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  })
  const syntaxError = diagnostics?.[0]
  if (syntaxError) {
    const line = syntaxError.file?.getLineAndCharacterOfPosition(syntaxError.start ?? 0).line
    return `Supabase CLI output is not valid TypeScript (${ts.flattenDiagnosticMessageText(syntaxError.messageText, ' ')}${line === undefined ? '' : `, line ${line + 1}`}).`
  }

  const sourceFile = ts.createSourceFile(
    'database.generated.ts',
    text,
    ts.ScriptTarget.ESNext,
    false,
    ts.ScriptKind.TS,
  )
  let hasDatabase = false
  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
      if (statement.name.text === 'Database' && ts.isTypeAliasDeclaration(statement))
        hasDatabase = isExported(statement)
      continue
    }
    if (isConstantsStatement(statement)) continue
    const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1
    return `Supabase CLI output has a non-type top-level statement (${ts.SyntaxKind[statement.kind]}, line ${line}); only type declarations and the literal ${constantsName} object are allowed.`
  }
  if (!hasDatabase) return 'Supabase CLI output does not declare `export type Database`.'
  return null
}

/**
 * Installs validated types with write-to-temp + rename in the same directory so the existing
 * file is never truncated. Returns { changed, bytes, sha256, lfSha256 }; throws without touching
 * the target. `lfSha256` is the digest of the LF-normalized installed body, i.e. exactly what the
 * task pipeline's source snapshot must observe for this file if nobody else touched it.
 */
export function installGeneratedTypes(target, text) {
  const body = text.endsWith('\n') ? text : `${text}\n`
  const sha256 = createHash('sha256').update(body).digest('hex')
  const lfSha256 = createHash('sha256').update(body.replace(/\r\n/g, '\n')).digest('hex')
  const bytes = Buffer.byteLength(body)
  if (existsSync(target) && readFileSync(target, 'utf8') === body)
    return { changed: false, bytes, sha256, lfSha256 }
  mkdirSync(dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  try {
    writeFileSync(temp, body, { flag: 'wx' })
    renameSync(temp, target)
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp)
    throw error
  }
  return { changed: true, bytes, sha256, lfSha256 }
}
