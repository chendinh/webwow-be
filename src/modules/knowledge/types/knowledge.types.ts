// ─────────── Constants ───────────

export const KNOWLEDGE_BRANCH = 'ai/architecture';
export const AI_MANIFEST_PATH = 'AI_MANIFEST.json';

export const KNOWLEDGE_DOCUMENTS = [
  'OVERVIEW.md',
  'PROJECT.md',
  'ARCHITECTURE.md',
  'MODULES.md',
  'API.md',
  'DATABASE.md',
  'DEPENDENCIES.md',
  'CONVENTIONS.md',
  'BUSINESS_RULES.md',
  'FILE_INDEX.md',
] as const;

export type KnowledgeDocumentName = (typeof KNOWLEDGE_DOCUMENTS)[number];

// ─────────── Status Types ───────────

export type DocumentStatus = 'complete' | 'not_applicable' | 'failed';
export type ManifestStatus = 'complete' | 'partial' | 'failed';

// ─────────── AIManifest Interface ───────────

export interface AIManifest {
  /** Must be >= 1 */
  schemaVersion: number;
  status: ManifestStatus;
  knowledgeBranch: 'ai/architecture';
  sourceBranch: string;
  /** 40-character hex SHA */
  sourceCommit: string;
  /** ISO 8601 timestamp */
  analyzedAt: string;
  documents: Record<
    KnowledgeDocumentName,
    {
      status: DocumentStatus;
      lastUpdatedCommit: string;
    }
  >;
}

// ─────────── KnowledgeStatusDto Interface ───────────

/**
 * Mirrors the Prisma KnowledgeAnalysisStatus enum.
 * Defined locally so this file has no Prisma client dependency
 * (Prisma client is generated separately and re-exports this type).
 */
export type KnowledgeAnalysisStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETE'
  | 'PARTIAL'
  | 'FAILED';

export interface KnowledgeStatusDto {
  analysisStatus: KnowledgeAnalysisStatus;
  lastAnalyzedCommit: string | null;
  /** ISO 8601 timestamp */
  lastAnalyzedAt: string | null;
  lastErrorMessage: string | null;
  /** true when no AI call or Git commit was needed (already up-to-date) */
  alreadyUpToDate?: boolean;
  documents?: Record<KnowledgeDocumentName, { status: DocumentStatus }>;
}

// ─────────── Change-to-Document Mapping ───────────

export const CHANGE_MAPPING: Array<{
  test: (path: string) => boolean;
  documents: KnowledgeDocumentName[];
}> = [
  {
    test: (p) =>
      p === 'prisma/schema.prisma' || p.startsWith('prisma/migrations/'),
    documents: ['DATABASE.md'],
  },
  {
    test: (p) =>
      p.toLowerCase().includes('controller') ||
      p.startsWith('src/api/') ||
      p.startsWith('src/routes/'),
    documents: ['API.md'],
  },
  {
    test: (p) => p === 'package.json' || p.endsWith('/package.json'),
    documents: ['DEPENDENCIES.md'],
  },
  {
    test: (p) => /^\.eslintrc|^tsconfig\.json|prettier\.config/.test(p),
    documents: ['CONVENTIONS.md'],
  },
  {
    test: (p) => p.startsWith('src/'),
    documents: ['ARCHITECTURE.md', 'MODULES.md'],
  },
];

/**
 * Returns the set of Knowledge Documents that need to be regenerated
 * given a list of changed file paths.
 *
 * Priority: first matching rule wins per file.
 */
export function mapChangesToDocuments(
  changedPaths: string[],
): Set<KnowledgeDocumentName> {
  const result = new Set<KnowledgeDocumentName>();
  for (const path of changedPaths) {
    for (const rule of CHANGE_MAPPING) {
      if (rule.test(path)) {
        rule.documents.forEach((d) => result.add(d));
        break; // first match wins
      }
    }
  }
  return result;
}

// ─────────── Secret Exclusion ───────────

export const SECRET_EXCLUDE_PATTERNS: RegExp[] = [
  /^\.env$/,
  /^\.env\..+/,
  /\.pem$/,
  /\.key$/,
  /secret/i,
  /credential/i,
];

/**
 * Returns true if the given file path matches any secret exclusion pattern.
 */
export function isExcludedFile(filePath: string): boolean {
  // Check against the basename for pattern-based matches (e.g. .env*, *.pem)
  const basename = filePath.split('/').pop() ?? filePath;
  return SECRET_EXCLUDE_PATTERNS.some(
    (pattern) => pattern.test(filePath) || pattern.test(basename),
  );
}

/**
 * Filters out files that match secret exclusion patterns.
 */
export function filterSafeFiles(filePaths: string[]): string[] {
  return filePaths.filter((p) => !isExcludedFile(p));
}

// Patterns for masking secrets within file content
const SECRET_CONTENT_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /ghp_[a-zA-Z0-9]{36}/g,
  // High-entropy base64 strings >= 40 chars (not containing common non-secret chars like spaces)
  /(?:[A-Za-z0-9+/]{40,}={0,2})/g,
];

/**
 * Replaces secret-like strings in content with `[MASKED]`.
 * Targets: OpenAI API keys (sk-), GitHub PATs (ghp_), and high-entropy base64 strings >= 40 chars.
 */
export function maskSecrets(content: string): string {
  let masked = content;
  for (const pattern of SECRET_CONTENT_PATTERNS) {
    masked = masked.replace(pattern, '[MASKED]');
  }
  return masked;
}

// ─────────── Manifest Validation ───────────

const VALID_MANIFEST_STATUSES: ManifestStatus[] = ['complete', 'partial', 'failed'];
const VALID_DOCUMENT_STATUSES: DocumentStatus[] = ['complete', 'not_applicable', 'failed'];

/**
 * Type guard that validates an unknown value conforms to the AIManifest shape.
 * Returns true only when all required fields are present and well-formed.
 */
export function validateManifest(obj: unknown): obj is AIManifest {
  // 1. Must be a non-null object
  if (typeof obj !== 'object' || obj === null) return false;

  const manifest = obj as Record<string, unknown>;

  // 2. schemaVersion must be a number >= 1
  if (
    typeof manifest.schemaVersion !== 'number' ||
    manifest.schemaVersion < 1
  ) {
    return false;
  }

  // 3. status must be one of the valid ManifestStatus values
  if (!VALID_MANIFEST_STATUSES.includes(manifest.status as ManifestStatus)) {
    return false;
  }

  // 4. knowledgeBranch must be a string
  if (typeof manifest.knowledgeBranch !== 'string') return false;

  // 5. sourceBranch must be a string
  if (typeof manifest.sourceBranch !== 'string') return false;

  // 6. sourceCommit must be a 40-character hex SHA
  if (
    typeof manifest.sourceCommit !== 'string' ||
    !/^[0-9a-f]{40}$/i.test(manifest.sourceCommit)
  ) {
    return false;
  }

  // 7. analyzedAt must be a valid ISO 8601 datetime string
  if (
    typeof manifest.analyzedAt !== 'string' ||
    isNaN(Date.parse(manifest.analyzedAt))
  ) {
    return false;
  }

  // 8. documents must be a non-null object
  if (typeof manifest.documents !== 'object' || manifest.documents === null) {
    return false;
  }

  // 9. Each document entry must have a valid DocumentStatus
  const documents = manifest.documents as Record<string, unknown>;
  for (const key of Object.keys(documents)) {
    const entry = documents[key];
    if (typeof entry !== 'object' || entry === null) return false;
    const entryStatus = (entry as Record<string, unknown>).status;
    if (!VALID_DOCUMENT_STATUSES.includes(entryStatus as DocumentStatus)) {
      return false;
    }
  }

  return true;
}

/**
 * Parses a raw JSON string and validates it as an AIManifest.
 * Returns the manifest if valid, or null if parsing or validation fails.
 */
export function parseManifest(raw: string): AIManifest | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return validateManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ─────────── Vietnamese Error Builder ───────────

/**
 * Builds a Vietnamese-language error message (≤ 500 chars) suitable for
 * display in the UI. Covers common GitHub/network failure scenarios.
 */
export function buildVietnameseError(err: unknown, context?: string): string {
  const base = context ? `[${context}] ` : '';

  if (err instanceof Error) {
    if (
      err.message.includes('Not Found') ||
      err.message.includes('404')
    ) {
      return `${base}Không tìm thấy repository hoặc branch. Kiểm tra cấu hình GitHub.`;
    }
    if (err.message.includes('rate limit')) {
      return `${base}GitHub API bị giới hạn tốc độ. Vui lòng thử lại sau.`;
    }
    if (err.message.includes('timeout')) {
      return `${base}Hết thời gian chờ khi kết nối GitHub. Vui lòng thử lại.`;
    }
  }

  return `${base}Phân tích kiến trúc thất bại. Vui lòng kiểm tra kết nối GitHub và thử lại.`;
}
