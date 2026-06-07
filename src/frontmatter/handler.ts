import type { App, TFile } from 'obsidian';
import { NoteBinding, AttachmentRecord } from '../types';

const FIELD = {
	URL: 'confluence_url',
	PARENT_URL: 'confluence_parent_url',
	PAGE_ID: 'confluence_page_id',
	LAST_SYNCED: 'confluence_last_synced',
	LAST_HASH: 'confluence_last_hash',
	ATTACHMENTS: 'confluence_attachments',
} as const;

/**
 * frontmatter 在 Obsidian 类型上是 `any`,但我们只读写已知字段,
 * 全局缩窄为 `Record<string, unknown>` 让 lint 不再报 no-unsafe-*。
 */
export type Frontmatter = Record<string, unknown>;

export interface BindingPatch {
	url?: string;
	pageId?: string;
	lastSynced?: string;
	lastHash?: string;
	attachments?: Record<string, AttachmentRecord>;
}

/**
 * 从 frontmatter 读取 Confluence 绑定信息。
 * 仅在存在 confluence_url 时返回非 null。
 */
export function readBindingFromCache(app: App, file: TFile, urlKey: string = FIELD.URL): NoteBinding | null {
	const fm = app.metadataCache.getFileCache(file)?.frontmatter as Frontmatter | undefined;
	if (!fm) return null;
	const rawUrl = fm[urlKey];
	const rawParent = fm[FIELD.PARENT_URL];
	const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
	const parentUrl = typeof rawParent === 'string' ? rawParent.trim() : '';
	// url 或 parent_url 至少一个有值,才是被本插件管理的笔记
	if (!url && !parentUrl) return null;

	const rawAttachments = fm[FIELD.ATTACHMENTS];
	const attachments = isAttachmentMap(rawAttachments) ? rawAttachments : undefined;
	const rawPageId = fm[FIELD.PAGE_ID];
	const rawLastSynced = fm[FIELD.LAST_SYNCED];
	const rawLastHash = fm[FIELD.LAST_HASH];

	return {
		url,
		parentUrl: parentUrl || undefined,
		pageId: typeof rawPageId === 'string' ? rawPageId : '',
		lastSynced: typeof rawLastSynced === 'string' ? rawLastSynced : undefined,
		lastHash: typeof rawLastHash === 'string' ? rawLastHash : undefined,
		attachments,
	};
}

/** 同步成功后回写 frontmatter。app.fileManager.processFrontMatter 会原子地处理。 */
export async function writeBinding(app: App, file: TFile, patch: BindingPatch): Promise<void> {
	await app.fileManager.processFrontMatter(file, (raw: unknown) => {
		const fm = raw as Frontmatter;
		if (patch.url !== undefined) fm[FIELD.URL] = patch.url;
		if (patch.pageId !== undefined) fm[FIELD.PAGE_ID] = patch.pageId;
		if (patch.lastSynced !== undefined) fm[FIELD.LAST_SYNCED] = patch.lastSynced;
		if (patch.lastHash !== undefined) fm[FIELD.LAST_HASH] = patch.lastHash;
		if (patch.attachments !== undefined) fm[FIELD.ATTACHMENTS] = patch.attachments;
	});
}

/** 给当前文件插入模板 frontmatter 字段(仅在尚未存在 confluence_url 时);返回是否插入了。 */
export async function insertTemplateFrontmatter(app: App, file: TFile, placeholderUrl = ''): Promise<boolean> {
	let inserted = false;
	await app.fileManager.processFrontMatter(file, (raw: unknown) => {
		const fm = raw as Frontmatter;
		const existing = fm[FIELD.URL];
		if (typeof existing === 'string' && existing.trim()) return;
		fm[FIELD.URL] = placeholderUrl;
		fm[FIELD.PARENT_URL] = '';
		fm[FIELD.PAGE_ID] = '';
		fm[FIELD.LAST_SYNCED] = '';
		fm[FIELD.LAST_HASH] = '';
		inserted = true;
	});
	return inserted;
}

function isAttachmentMap(v: unknown): v is Record<string, AttachmentRecord> {
	if (!v || typeof v !== 'object') return false;
	for (const k of Object.keys(v as Record<string, unknown>)) {
		const entry = (v as Record<string, unknown>)[k];
		if (!entry || typeof entry !== 'object') return false;
		const e = entry as Record<string, unknown>;
		if (typeof e.hash !== 'string' || typeof e.id !== 'string') return false;
	}
	return true;
}

export const FrontmatterFields = FIELD;
