import { describe, expect, mock, test } from 'bun:test';

mock.module('obsidian', () => ({
	requestUrl: () => { throw new Error('Unexpected network request'); },
	App: class App {},
	Component: class Component {},
	MarkdownRenderer: {},
	TFile: class TFile {},
	PluginSettingTab: class PluginSettingTab {},
	Setting: class Setting {},
	Notice: class Notice {},
}));

(globalThis as { window?: unknown }).window ??= globalThis;

const { MarkdownConverter } = await import('../src/confluence/markdownConverter');
const { SyncEngine } = await import('../src/sync/syncEngine');

const context = {
	attachedFilenames: new Set<string>(),
	mermaidFilenameByHash: new Map<string, string>(),
	plantUmlFilenameByHash: new Map<string, string>(),
	renderMermaidToPng: false,
	renderPlantUmlToPng: false,
	defaultImageWidthPx: 0,
	stripSupplementaryChars: false,
};
const converter = new MarkdownConverter({} as never);
const userLink = '<ac:link><ri:user ri:username="john.d" /></ac:link>';

describe('wikilink user mentions', () => {
	test('resolves plain links, aliases, paths, and escaped table aliases without a page resolver', async () => {
		const paths: string[] = [];
		const storage = await converter.convert([
			'[[John Doe]] [[John Doe|John]] [[People/John Doe|John]]',
			'',
			'| Person |',
			'| --- |',
			'| [[John Doe\\|John]] |',
		].join('\n'), 'notes/source.md', {
			...context,
			resolveMention: (path, source) => {
				expect(source).toBe('notes/source.md');
				paths.push(path);
				return 'john.d';
			},
		});

		expect(paths).toEqual(['John Doe', 'John Doe', 'People/John Doe', 'John Doe']);
		expect(storage.split(userLink)).toHaveLength(5);
	});

	test('prefers a mention when the target also has a page URL', async () => {
		const resolveWikilink = mock(() => 'https://cf.test/pages/456');
		const storage = await converter.convert('[[John Doe]]', 'source.md', {
			...context,
			resolveMention: () => 'john.d',
			resolveWikilink,
		});

		expect(storage).toBe(`<p>${userLink}</p>`);
		expect(resolveWikilink).not.toHaveBeenCalled();
	});

	test('falls back to page links or plain text without a username', async () => {
		const storage = await converter.convert('[[Page|Docs]] [[Missing|Person]]', 'source.md', {
			...context,
			resolveMention: () => null,
			resolveWikilink: (path) => path === 'Page' ? 'https://cf.test/pages/456' : null,
		});

		expect(storage).toBe('<p><a href="https://cf.test/pages/456">Docs</a> Person</p>');
	});

	test('preserves legacy mentions and their fallback text', async () => {
		const storage = await converter.convert('@[[John Doe|John]] @[[Missing|Alias]]', 'source.md', {
			...context,
			resolveMention: (path) => path === 'John Doe' ? 'john.d' : null,
			resolveWikilink: () => 'https://cf.test/pages/456',
		});

		expect(storage).toBe(`<p>${userLink} @Alias</p>`);
	});

	test('preserves anchors, embeds, Markdown links, and code examples', async () => {
		const resolveMention = mock(() => 'john.d');
		const storage = await converter.convert([
			'[[#Heading]] [[John Doe#Heading|Section]] [[John Doe#^block]]',
			'',
			'![[John Doe]] [John](John.md)',
			'',
			'`[[John Doe]]` `@[[John Doe]]`',
			'',
			'```markdown',
			'[[John Doe]] @[[John Doe]]',
			'```',
		].join('\n'), 'source.md', {
			...context,
			resolveMention,
			resolveWikilink: () => ({ url: 'https://cf.test/pages/456', title: 'John Doe' }),
		});

		expect(resolveMention).not.toHaveBeenCalled();
		expect(storage).not.toContain('<ri:user');
		expect(storage).toContain('ac:anchor="Heading"');
		expect(storage).toContain('<ri:page ri:content-title="John Doe" />');
		expect(storage).toContain('<a href="https://cf.test/pages/456">John</a>');
		expect(storage).toContain('<!-- 未上传的附件: John Doe -->');
		expect(storage).toContain('<code>[[John Doe]]</code>');
		expect(storage).toContain('<![CDATA[[[John Doe]] @[[John Doe]]');
	});

	test('escapes usernames in the storage attribute', async () => {
		const storage = await converter.convert('[[John Doe]]', 'source.md', {
			...context,
			resolveMention: () => 'john"<&',
		});

		expect(storage).toContain('ri:username="john&quot;&lt;&amp;"');
	});
});

function makeSyncFixture(username: unknown, pageUrl?: string) {
	const instance = {
		id: 'work', name: 'Work', baseUrl: 'https://cf.test', authType: 'bearer',
		username: '', apiToken: 'token', stripSupplementaryChars: false,
	};
	const file = { path: 'notes/source.md', basename: 'source', extension: 'md' };
	const person = { path: 'People/John Doe.md', basename: 'John Doe', extension: 'md' };
	const frontmatter: Record<string, unknown> = {
		confluence_url: 'https://cf.test/pages/viewpage.action?pageId=123',
		confluence_page_id: '123',
	};
	const personFrontmatter: Record<string, unknown> = {
		confluence_username: username,
		...(pageUrl ? { confluence_url: pageUrl } : {}),
	};
	const payloads: Array<{ storageXhtml: string }> = [];
	const engine = new SyncEngine({
		app: {
			metadataCache: {
				getFileCache: (target: unknown) => ({ frontmatter: target === person ? personFrontmatter : frontmatter }),
				getFirstLinkpathDest: (path: string, source: string) => {
					expect(source).toBe(file.path);
					return path === 'John Doe' ? person : null;
				},
			},
			vault: { cachedRead: async () => '[[John Doe]]' },
			fileManager: {
				processFrontMatter: async (_file: unknown, update: (fm: Record<string, unknown>) => void) => update(frontmatter),
			},
		} as never,
		settings: {
			frontmatterKey: 'confluence_url', instances: [instance], uploadAttachments: false,
			maxAttachmentSizeMB: 10, ...context,
		} as never,
		logger: { info: () => {}, warn: () => {}, error: () => {}, recordSyncTime: () => {} } as never,
		api: {
			getPage: async () => ({ id: '123', title: 'source', version: 1, type: 'page', spaceKey: 'DOC' }),
			updatePage: async (_pageId: string, payload: { storageXhtml: string }) => { payloads.push(payload); },
		} as never,
		instance: instance as never,
		instances: [instance] as never,
	});
	return { engine, file, personFrontmatter, payloads };
}

describe('SyncEngine wikilink mentions', () => {
	test('uses the current instance username and resyncs when the target username changes', async () => {
		const { engine, file, personFrontmatter, payloads } = makeSyncFixture({ work: ' john.d ', other: 'foreign' });

		expect((await engine.syncOne(file as never))?.success).toBe(true);
		expect(payloads[0]?.storageXhtml).toBe(`<p>${userLink}</p>`);
		expect((await engine.syncOne(file as never))?.skipped).toBe(true);
		personFrontmatter.confluence_username = { work: 'john.renamed', other: 'foreign' };
		expect((await engine.syncOne(file as never))?.success).toBe(true);
		expect(payloads[1]?.storageXhtml).toContain('ri:username="john.renamed"');
		personFrontmatter.confluence_username = { other: 'foreign' };
		expect((await engine.syncOne(file as never))?.success).toBe(true);
		expect(payloads[2]?.storageXhtml).toBe('<p>John Doe</p>');
		expect(payloads).toHaveLength(3);
	});

	test('switches an already synced page link to a mention when a username is added', async () => {
		const pageUrl = 'https://cf.test/pages/viewpage.action?pageId=456';
		const { engine, file, personFrontmatter, payloads } = makeSyncFixture(undefined, pageUrl);
		expect((await engine.syncOne(file as never))?.success).toBe(true);
		expect(payloads[0]?.storageXhtml).toContain(`href="${pageUrl}"`);
		personFrontmatter.confluence_username = { work: 'john.d' };
		expect((await engine.syncOne(file as never))?.success).toBe(true);
		expect(payloads[1]?.storageXhtml).toBe(`<p>${userLink}</p>`);
		expect(payloads).toHaveLength(2);
	});

	test('ignores foreign, empty, and invalid usernames while preserving page links', async () => {
		const pageUrl = 'https://cf.test/pages/viewpage.action?pageId=456';
		for (const username of [undefined, { other: 'foreign' }, { work: '  ' }, { work: 123 }, ['john.d'], 'john.d']) {
			const { engine, file, payloads } = makeSyncFixture(username, pageUrl);
			expect((await engine.syncOne(file as never))?.success).toBe(true);
			expect(payloads[0]?.storageXhtml).toBe(`<p><a href="${pageUrl}">John Doe</a></p>`);
		}
	});
});
