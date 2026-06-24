import type { App, TFile } from 'obsidian';
import { ConfluenceInstance } from '../types';

export interface InstanceResolverDeps {
	instances: ConfluenceInstance[];
}

/**
 * 将笔记 URL 解析到对应的 Confluence 实例。
 * 使用最长前缀匹配:取 baseUrl 最长且为 noteUrl 前缀的实例。
 */
export class InstanceResolver {
	constructor(private deps: InstanceResolverDeps) {}

	resolve(url: string): ConfluenceInstance | null {
		if (!url || typeof url !== 'string') return null;
		const normalizedUrl = url.trim().replace(/\/+$/, '').toLowerCase();
		if (!normalizedUrl) return null;

		let best: ConfluenceInstance | null = null;
		let bestLen = -1;

		for (const inst of this.deps.instances) {
			if (!inst.baseUrl) continue;
			const base = inst.baseUrl.trim().replace(/\/+$/, '').toLowerCase();
			if (!base) continue;
			if (normalizedUrl.startsWith(base) && base.length > bestLen) {
				best = inst;
				bestLen = base.length;
			}
		}

		return best;
	}

	groupByInstance(
		files: TFile[],
		app: App,
		frontmatterKey: string,
	): {
		groups: Map<string, { instance: ConfluenceInstance; files: TFile[] }>;
		unmatched: TFile[];
	} {
		const groups = new Map<string, { instance: ConfluenceInstance; files: TFile[] }>();
		const unmatched: TFile[] = [];

		for (const file of files) {
			const cache = app.metadataCache.getFileCache(file);
			const fm = cache?.frontmatter;
			const url = (typeof fm?.[frontmatterKey] === 'string' ? fm[frontmatterKey] : '') || '';
			const parentUrl = (typeof fm?.['confluence_parent_url'] === 'string' ? fm['confluence_parent_url'] : '') || '';
			const targetUrl = url.trim() || parentUrl.trim();

			if (!targetUrl) {
				unmatched.push(file);
				continue;
			}

			const inst = this.resolve(targetUrl);
			if (!inst) {
				unmatched.push(file);
				continue;
			}

			const existing = groups.get(inst.id);
			if (existing) {
				existing.files.push(file);
			} else {
				groups.set(inst.id, { instance: inst, files: [file] });
			}
		}

		return { groups, unmatched };
	}
}
