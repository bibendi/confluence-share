import type { TFile } from 'obsidian';
import { t } from './i18n';

export interface LogEntry {
	timestamp: Date;
	level: 'info' | 'warn' | 'error';
	message: string;
	details?: string;
}

export enum SyncStatus {
	Idle = 'idle',
	Syncing = 'syncing',
	Success = 'success',
	Failed = 'failed',
	Partial = 'partial',
}

/**
 * Label shown in the status-bar pill. Evaluated lazily via getters so the
 * active locale (resolved once at i18n load time) is applied at read time.
 */
export const SyncStatusText: Record<SyncStatus, string> = {
	get [SyncStatus.Idle]() { return t('status.idle'); },
	get [SyncStatus.Syncing]() { return t('status.syncing'); },
	get [SyncStatus.Success]() { return t('status.success'); },
	get [SyncStatus.Failed]() { return t('status.failed'); },
	get [SyncStatus.Partial]() { return t('status.partial'); },
} as Record<SyncStatus, string>;

/** 单个笔记的 Confluence 绑定信息(从 frontmatter 读出) */
export interface NoteBinding {
	/** confluence_url。空字符串表示尚未创建页面,需要配合 parentUrl 走 createPage 流程 */
	url: string;
	pageId: string;
	/** confluence_parent_url。仅在 url 为空时使用,指定新页面挂哪个父页 */
	parentUrl?: string;
	lastSynced?: string;
	lastHash?: string;
	/** filename -> { hash, id } 附件缓存,用于跳过重传 */
	attachments?: Record<string, AttachmentRecord>;
}

export interface AttachmentRecord {
	hash: string;
	id: string;
}

/** markdown 中提取出的本地附件引用 */
export interface AttachmentRef {
	/** Obsidian 内的源 markdown 字符串片段,后续用于替换 */
	rawMatch: string;
	/** 链接或路径文本 */
	linkpath: string;
	/** alt 文本(可选) */
	alt: string;
	/** Obsidian 解析到的实际文件,可能为 null(链接断了) */
	tfile: TFile | null;
	/** 显示用文件名(用于 Confluence 附件名) */
	filename: string;
}

/** 单文件同步结果 */
export interface FileSyncResult {
	path: string;
	skipped: boolean;
	success: boolean;
	error?: string;
	uploadedAttachments?: number;
	skippedAttachments?: number;
}

/** 一次 syncAll 的汇总 */
export interface BatchSyncResult {
	total: number;
	updated: number;
	skipped: number;
	failed: number;
	files: FileSyncResult[];
}

// ========== Multi-Confluence Support Types ==========

/** 单个 Confluence 实例配置 */
export interface ConfluenceInstance {
	/** 稳定标识符(用于 SecretStorage 密钥派生和 UI 引用) */
	id: string;
	/** 显示名称 */
	name: string;
	/** 例: https://your-domain.atlassian.net/wiki */
	baseUrl: string;
	/** 认证方式:basic(用户名+密码/Token)或 bearer(PAT) */
	authType: 'basic' | 'bearer';
	/** basic 模式必填 */
	username: string;
	/** SecretStorage 中保存的密钥名称(不存明文) */
	apiToken: string;
}

/** 单个实例的同步结果 */
export interface PerInstanceSyncResult {
	instanceName: string;
	instanceId: string;
	total: number;
	updated: number;
	skipped: number;
	failed: number;
	files: FileSyncResult[];
}

/** 多实例批量同步结果 */
export interface MultiInstanceBatchResult {
	instances: PerInstanceSyncResult[];
	total: number;
	updated: number;
	skipped: number;
	failed: number;
	/** 未匹配到任何实例的文件 */
	unmatched: FileSyncResult[];
}
