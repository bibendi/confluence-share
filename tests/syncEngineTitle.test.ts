import { describe, expect, mock, test } from 'bun:test';

mock.module('obsidian', () => ({
	requestUrl: () => {
		throw new Error('requestUrl must not be called by sync engine tests');
	},
	App: class App {},
	Component: class Component {},
	MarkdownRenderer: {},
	TFile: class TFile {},
	PluginSettingTab: class PluginSettingTab {},
	Setting: class Setting {},
	Notice: class Notice {},
}));

(globalThis as { window?: unknown }).window ??= globalThis;

const { SyncEngine } = await import('../src/sync/syncEngine');

const instance = {
	id: 'default',
	name: 'Default',
	baseUrl: 'https://cf.test',
	authType: 'bearer',
	username: '',
	apiToken: 'token',
	stripSupplementaryChars: false,
};

const settings = {
	frontmatterKey: 'confluence_url',
	instances: [instance],
	uploadAttachments: false,
	maxAttachmentSizeMB: 10,
	defaultImageWidthPx: 192,
	renderMermaidToPng: false,
	renderPlantUmlToPng: false,
};

function makeLogger() {
	return {
		info: () => {},
		warn: () => {},
		error: () => {},
		recordSyncTime: () => {},
	};
}

function makeApp(frontmatter: Record<string, unknown>) {
	return {
		metadataCache: {
			getFileCache: () => ({ frontmatter }),
			getFirstLinkpathDest: () => null,
		},
		vault: {
			cachedRead: async () => '# Body',
		},
		fileManager: {
			processFrontMatter: async (_file: unknown, update: (fm: Record<string, unknown>) => void) => {
				update(frontmatter);
			},
		},
	};
}

function makeFile() {
	return { path: 'notes/test.md', basename: 'test', extension: 'md' };
}

describe('SyncEngine custom Confluence title', () => {
	test('uses confluence_title and does not skip when only the title changes', async () => {
		const frontmatter: Record<string, unknown> = {
			confluence_url: 'https://cf.test/pages/viewpage.action?pageId=123',
			confluence_page_id: '123',
			confluence_title: 'Custom title',
		};
		const updatePayloads: Array<{ title: string }> = [];
		const api = {
			getPage: async () => ({ id: '123', title: 'old', version: 1, type: 'page', spaceKey: 'DOC' }),
			updatePage: async (_pageId: string, payload: { title: string }) => {
				updatePayloads.push(payload);
			},
		};
		const engine = new SyncEngine({
			app: makeApp(frontmatter) as never,
			settings: settings as never,
			logger: makeLogger() as never,
			api: api as never,
			instance: instance as never,
			instances: [instance] as never,
		});

		const file = makeFile();
		const first = await engine.syncOne(file as never);
		const skipped = await engine.syncOne(file as never);
		frontmatter.confluence_title = 'Renamed title';
		const renamed = await engine.syncOne(file as never);
		frontmatter.confluence_title = 2025;
		const numeric = await engine.syncOne(file as never);

		expect(first?.success).toBe(true);
		expect(skipped?.skipped).toBe(true);
		expect(renamed?.success).toBe(true);
		expect(numeric?.success).toBe(true);
		expect(updatePayloads.map((payload) => payload.title)).toEqual(['Custom title', 'Renamed title', '2025']);
	});

	test('uses confluence_title when creating a new page', async () => {
		const frontmatter: Record<string, unknown> = {
			confluence_parent_url: 'https://cf.test/pages/viewpage.action?pageId=10',
			confluence_url: '',
			confluence_page_id: '',
			confluence_title: 'Created title',
		};
		const createdTitles: string[] = [];
		const updatedTitles: string[] = [];
		const api = {
			getPage: async (pageId: string) => pageId === '10'
				? { id: '10', title: 'parent', version: 1, type: 'page', spaceKey: 'DOC' }
				: { id: '123', title: 'Created title', version: 1, type: 'page', spaceKey: 'DOC' },
			createPage: async (opts: { title: string }) => {
				createdTitles.push(opts.title);
				return { id: '123', title: opts.title, webUrl: 'https://cf.test/pages/viewpage.action?pageId=123' };
			},
			updatePage: async (_pageId: string, payload: { title: string }) => {
				updatedTitles.push(payload.title);
			},
		};
		const engine = new SyncEngine({
			app: makeApp(frontmatter) as never,
			settings: settings as never,
			logger: makeLogger() as never,
			api: api as never,
			instance: instance as never,
			instances: [instance] as never,
		});

		const result = await engine.syncOne(makeFile() as never);

		expect(result?.success).toBe(true);
		expect(createdTitles).toEqual(['Created title']);
		expect(updatedTitles).toEqual(['Created title']);
	});
});
