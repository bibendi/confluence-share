import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import * as obsidianModule from 'obsidian';
import type SyncConfluencePlugin from './main';
import { ConfluenceApi, ConfluenceAuthType } from './confluence/api';
import { t } from './i18n';
import { ConfluenceInstance } from './types';

export interface SyncConfluenceSettings {
	// ========== 认证(legacy flat fields — kept for migration) ==========
	/** 例: https://your-domain.atlassian.net/wiki */
	confluenceBaseUrl: string;
	/** 认证方式:basic(用户名+密码/Token)或 bearer(PAT) */
	authType: ConfluenceAuthType;
	/** basic 模式必填:Cloud 是邮箱,Server 是域账号;bearer 模式忽略 */
	username: string;
	/** SecretStorage 中保存的密钥名称(不存明文)。basic→密码/API Token,bearer→PAT */
	apiToken: string;

	// ========== 多实例配置 ==========
	instances: ConfluenceInstance[];

	// ========== 调度 ==========
	/** 分钟,0=禁用定时同步 */
	syncInterval: number;
	syncOnStartup: boolean;

	// ========== 扫描范围 ==========
	/** 仅扫描这些目录(相对 vault 根),空数组=全 vault */
	scanFolders: string[];
	/** glob 模式列表,匹配的文件跳过 */
	ignorePatterns: string[];

	// ========== 模板 ==========
	templateFolderPath: string;
	autoInstallTemplate: boolean;

	// ========== 行为 ==========
	showStatusBar: boolean;
	showNotice: boolean;
	frontmatterKey: string;

	// ========== 附件 ==========
	uploadAttachments: boolean;
	maxAttachmentSizeMB: number;

	// ========== 图表渲染 ==========
	renderMermaidToPng: boolean;
	mermaidRenderUrl: string;
	renderPlantUmlToPng: boolean;
	plantUmlServerUrl: string;
}

export const DEFAULT_SETTINGS: SyncConfluenceSettings = {
	confluenceBaseUrl: '',
	authType: 'basic',
	username: '',
	apiToken: '',

	instances: [],

	syncInterval: 30,
	syncOnStartup: false,

	scanFolders: [],
	// 注:Obsidian 配置目录(默认 .obsidian,用户可自定义)由 scanBoundNotes 隐式忽略,
	// 这里只列用户场景里常见的额外忽略项。
	ignorePatterns: ['.trash/**', 'templates/**'],

	templateFolderPath: 'templates',
	autoInstallTemplate: true,

	showStatusBar: true,
	showNotice: true,
	frontmatterKey: 'confluence_url',

	uploadAttachments: true,
	maxAttachmentSizeMB: 10,

	renderMermaidToPng: true,
	mermaidRenderUrl: 'https://kroki.io/mermaid/png',
	renderPlantUmlToPng: false,
	plantUmlServerUrl: 'https://www.plantuml.com/plantuml',
};

export class SyncConfluenceSettingTab extends PluginSettingTab {
	plugin: SyncConfluencePlugin;
	private authResultEls: Map<string, HTMLElement> = new Map();

	constructor(app: App, plugin: SyncConfluencePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();
		this.authResultEls.clear();

		// ===== 认证 / 多实例 =====
		this.renderSection(containerEl, t('settings.section.auth'), (el) => {
			// 确保至少有一个实例
			if (!s.instances || s.instances.length === 0) {
				s.instances = [this.createDefaultInstance()];
			}

			s.instances.forEach((inst, idx) => {
				this.renderInstanceCard(el, inst, idx);
			});

			new Setting(el)
				.addButton((btn) => btn.setButtonText(t('settings.instances.add')).setCta().onClick(async () => {
					s.instances.push(this.createDefaultInstance());
					await this.plugin.saveSettings();
					this.display();
				}));
		});

		// ===== 同步调度 =====
		this.renderSection(containerEl, t('settings.section.schedule'), (el) => {
			new Setting(el)
				.setName(t('settings.interval.name'))
				.setDesc(t('settings.interval.desc'))
				.addText((tx) => tx
					.setPlaceholder('30')
					.setValue(String(s.syncInterval))
					.onChange(async (v) => {
						const n = parseInt(v, 10);
						s.syncInterval = isNaN(n) || n < 0 ? 0 : n;
						await this.plugin.saveSettings();
						this.plugin.restartSyncInterval();
					}));

			new Setting(el)
				.setName(t('settings.syncOnStartup.name'))
				.setDesc(t('settings.syncOnStartup.desc'))
				.addToggle((tx) => tx.setValue(s.syncOnStartup).onChange(async (v) => {
					s.syncOnStartup = v;
					await this.plugin.saveSettings();
				}));

			new Setting(el)
				.addButton((btn) => btn.setButtonText(t('settings.syncNow')).setCta().onClick(async () => {
					await this.plugin.syncAll();
				}));
		});

		// ===== 扫描范围 =====
		this.renderSection(containerEl, t('settings.section.scope'), (el) => {
			new Setting(el)
				.setName(t('settings.scanFolders.name'))
				.setDesc(t('settings.scanFolders.desc'))
				.then((setting) => {
					const ta = setting.controlEl.createEl('textarea', { cls: 'sync-confluence-textarea' });
					ta.value = s.scanFolders.join('\n');
					ta.addEventListener('change', () => {
						s.scanFolders = ta.value.split('\n').map((x) => x.trim()).filter(Boolean);
						void this.plugin.saveSettings();
					});
				});

			new Setting(el)
				.setName(t('settings.ignore.name'))
				.setDesc(t('settings.ignore.desc'))
				.then((setting) => {
					const ta = setting.controlEl.createEl('textarea', { cls: 'sync-confluence-textarea' });
					ta.value = s.ignorePatterns.join('\n');
					ta.addEventListener('change', () => {
						s.ignorePatterns = ta.value.split('\n').map((x) => x.trim()).filter(Boolean);
						void this.plugin.saveSettings();
					});
				});
		});

		// ===== 模板 =====
		this.renderSection(containerEl, t('settings.section.template'), (el) => {
			new Setting(el)
				.setName(t('settings.templateFolder.name'))
				.setDesc(t('settings.templateFolder.desc'))
				.addText((tx) => tx
					.setPlaceholder('templates')
					.setValue(s.templateFolderPath)
					.onChange(async (v) => {
						s.templateFolderPath = v.trim() || 'templates';
						await this.plugin.saveSettings();
					}));

			new Setting(el)
				.setName(t('settings.autoInstallTemplate.name'))
				.setDesc(t('settings.autoInstallTemplate.desc'))
				.addToggle((tx) => tx.setValue(s.autoInstallTemplate).onChange(async (v) => {
					s.autoInstallTemplate = v;
					await this.plugin.saveSettings();
				}));

			new Setting(el)
				.addButton((btn) => btn.setButtonText(t('settings.writeTemplateNow')).onClick(async () => {
					const ok = await this.plugin.installTemplateFile(true);
					new Notice(ok ? t('notice.templateWritten') : t('notice.templateWriteFailed'));
				}));
		});

		// ===== 附件 =====
		this.renderSection(containerEl, t('settings.section.attachments'), (el) => {
			new Setting(el)
				.setName(t('settings.uploadAttachments.name'))
				.setDesc(t('settings.uploadAttachments.desc'))
				.addToggle((tx) => tx.setValue(s.uploadAttachments).onChange(async (v) => {
					s.uploadAttachments = v;
					await this.plugin.saveSettings();
				}));

			new Setting(el)
				.setName(t('settings.maxAttachmentSize.name'))
				.setDesc(t('settings.maxAttachmentSize.desc'))
				.addText((tx) => tx
					.setValue(String(s.maxAttachmentSizeMB))
					.onChange(async (v) => {
						const n = parseFloat(v);
						s.maxAttachmentSizeMB = isNaN(n) || n <= 0 ? 10 : n;
						await this.plugin.saveSettings();
					}));
		});

		// ===== 图表渲染 =====
		this.renderSection(containerEl, t('settings.section.diagrams'), (el) => {
			el.createEl('p', {
				text: t('settings.diagramsIntro'),
				cls: 'setting-item-description',
			});

			new Setting(el)
				.setName(t('settings.mermaid.toggleName'))
				.setDesc(t('settings.mermaid.toggleDesc'))
				.addToggle((tx) => tx.setValue(s.renderMermaidToPng).onChange(async (v) => {
					s.renderMermaidToPng = v;
					await this.plugin.saveSettings();
					this.plugin.rebuildSyncEngine();
				}));

			new Setting(el)
				.setName(t('settings.mermaid.urlName'))
				.setDesc(t('settings.mermaid.urlDesc'))
				.addText((tx) => tx
					.setPlaceholder('https://kroki.io/mermaid/png')
					.setValue(s.mermaidRenderUrl)
					.onChange(async (v) => {
						s.mermaidRenderUrl = v.trim() || DEFAULT_SETTINGS.mermaidRenderUrl;
						await this.plugin.saveSettings();
						this.plugin.rebuildSyncEngine();
					}));

			new Setting(el)
				.setName(t('settings.plantuml.toggleName'))
				.setDesc(t('settings.plantuml.toggleDesc'))
				.addToggle((tx) => tx.setValue(s.renderPlantUmlToPng).onChange(async (v) => {
					s.renderPlantUmlToPng = v;
					await this.plugin.saveSettings();
					this.plugin.rebuildSyncEngine();
				}));

			new Setting(el)
				.setName(t('settings.plantuml.urlName'))
				.setDesc(t('settings.plantuml.urlDesc'))
				.addText((tx) => tx
					.setPlaceholder('https://www.plantuml.com/plantuml')
					.setValue(s.plantUmlServerUrl)
					.onChange(async (v) => {
						s.plantUmlServerUrl = v.trim() || DEFAULT_SETTINGS.plantUmlServerUrl;
						await this.plugin.saveSettings();
						this.plugin.rebuildSyncEngine();
					}));
		});

		// ===== UI 行为 =====
		this.renderSection(containerEl, t('settings.section.ui'), (el) => {
			new Setting(el)
				.setName(t('settings.showStatusBar.name'))
				.addToggle((tx) => tx.setValue(s.showStatusBar).onChange(async (v) => {
					s.showStatusBar = v;
					await this.plugin.saveSettings();
					this.plugin.updateStatusBarVisibility();
				}));

			new Setting(el)
				.setName(t('settings.showNotice.name'))
				.setDesc(t('settings.showNotice.desc'))
				.addToggle((tx) => tx.setValue(s.showNotice).onChange(async (v) => {
					s.showNotice = v;
					await this.plugin.saveSettings();
				}));

			new Setting(el)
				.setName(t('settings.frontmatterKey.name'))
				.setDesc(t('settings.frontmatterKey.desc'))
				.addText((tx) => tx
					.setPlaceholder('confluence_url')
					.setValue(s.frontmatterKey)
					.onChange(async (v) => {
						s.frontmatterKey = v.trim() || 'confluence_url';
						await this.plugin.saveSettings();
					}));
		});
	}

	private renderSection(parent: HTMLElement, title: string, build: (el: HTMLElement) => void): void {
		const section = parent.createDiv({ cls: 'sync-confluence-section' });
		new Setting(section).setName(title).setHeading();
		build(section);
	}

	private createDefaultInstance(): ConfluenceInstance {
		return {
			id: this.generateInstanceId(),
			name: 'New Instance',
			baseUrl: '',
			authType: 'basic',
			username: '',
			apiToken: '',
		};
	}

	private generateInstanceId(): string {
		return 'inst-' + Math.random().toString(36).slice(2, 9);
	}

	private renderInstanceCard(parent: HTMLElement, inst: ConfluenceInstance, idx: number): void {
		const card = parent.createDiv({ cls: 'sync-confluence-instance-card' });
		const isSingle = this.plugin.settings.instances.length <= 1;

		// Header with name + actions
		new Setting(card)
			.setName(inst.name || t('settings.instances.name'))
			.setHeading()
			.addButton((btn) => btn.setIcon('arrow-up').setTooltip(t('settings.instances.moveUp')).onClick(async () => {
				if (idx <= 0) return;
				const arr = this.plugin.settings.instances;
				const a = arr[idx - 1]!;
				const b = arr[idx]!;
				arr[idx - 1] = b;
				arr[idx] = a;
				await this.plugin.saveSettings();
				this.display();
			}))
			.addButton((btn) => btn.setIcon('arrow-down').setTooltip(t('settings.instances.moveDown')).onClick(async () => {
				const arr = this.plugin.settings.instances;
				if (idx >= arr.length - 1) return;
				const a = arr[idx]!;
				const b = arr[idx + 1]!;
				arr[idx] = b;
				arr[idx + 1] = a;
				await this.plugin.saveSettings();
				this.display();
			}))
			.addButton((btn) => btn.setIcon('trash').setTooltip(t('settings.instances.remove')).setDisabled(isSingle).onClick(async () => {
				if (isSingle) return;
				// 删除该实例的 SecretStorage key
				if (inst.apiToken) {
					const storage = (this.app as unknown as { secretStorage?: { deleteSecret?(key: string): unknown } }).secretStorage;
					if (storage && typeof storage.deleteSecret === 'function') {
						try {
							const raw = storage.deleteSecret(inst.apiToken);
							if (raw && typeof (raw as { then?: unknown }).then === 'function') await (raw as Promise<unknown>);
						} catch { /* ignore */ }
					}
				}
				this.plugin.settings.instances.splice(idx, 1);
				await this.plugin.saveSettings();
				this.display();
			}));

		// Name
		new Setting(card)
			.setName(t('settings.instances.name'))
			.setDesc(t('settings.instances.nameDesc'))
			.addText((tx) => tx
				.setPlaceholder('Company A')
				.setValue(inst.name)
				.onChange(async (v) => {
					inst.name = v.trim();
					await this.plugin.saveSettings();
					this.display();
				}));

		// Base URL
		new Setting(card)
			.setName(t('settings.baseUrl.name'))
			.setDesc(t('settings.baseUrl.desc'))
			.addText((tx) => tx
				.setPlaceholder('https://xxx.atlassian.net/wiki')
				.setValue(inst.baseUrl)
				.onChange(async (v) => {
					inst.baseUrl = v.trim().replace(/\/+$/, '');
					await this.plugin.saveSettings();
				}));

		// Auth type
		new Setting(card)
			.setName(t('settings.authType.name'))
			.setDesc(t('settings.authType.desc'))
			.addDropdown((d) => d
				.addOption('basic', t('settings.authType.basic'))
				.addOption('bearer', t('settings.authType.bearer'))
				.setValue(inst.authType)
				.onChange(async (v) => {
					inst.authType = v as ConfluenceAuthType;
					await this.plugin.saveSettings();
					this.display();
				}));

		if (inst.authType === 'basic') {
			new Setting(card)
				.setName(t('settings.username.name'))
				.setDesc(t('settings.username.desc'))
				.addText((tx) => tx
					.setPlaceholder(t('settings.username.placeholder'))
					.setValue(inst.username)
					.onChange(async (v) => {
						inst.username = v.trim();
						await this.plugin.saveSettings();
					}));
		}

		// Token
		this.renderInstanceTokenSetting(card, inst);

		// Validate
		new Setting(card)
			.addButton((btn) => btn.setButtonText(t('settings.validate.button')).setCta().onClick(async () => {
				await this.runValidateAuthForInstance(inst);
			}));

		const resultEl = card.createDiv({ cls: 'sync-confluence-auth-result' });
		this.authResultEls.set(inst.id, resultEl);

		// Uniqueness errors
		const nameDup = this.plugin.settings.instances.some((other, oi) => oi !== idx && other.name === inst.name);
		const urlDup = this.plugin.settings.instances.some((other, oi) => oi !== idx && other.baseUrl && other.baseUrl === inst.baseUrl);
		if (nameDup) {
			card.createDiv({ cls: 'sync-confluence-error', text: t('settings.instances.duplicateName') });
		}
		if (urlDup) {
			card.createDiv({ cls: 'sync-confluence-error', text: t('settings.instances.duplicateBaseUrl') });
		}
	}

	private renderInstanceTokenSetting(parent: HTMLElement, inst: ConfluenceInstance): void {
		const isBearer = inst.authType === 'bearer';
		new Setting(parent)
			.setName(isBearer ? t('settings.token.nameBearer') : t('settings.token.nameBasic'))
			.setDesc(isBearer ? t('settings.token.descBearer') : t('settings.token.descBasic'))
			.addText((tx) => tx
				.setPlaceholder(t('settings.token.placeholderPasteToken'))
				.setValue('') // 不显示已保存的 token 值
				.onChange(async (v) => {
					const raw = v.trim();
					if (!raw) return;
					const key = `sync-confluence-token-${inst.id}`;
					const storage = (this.app as unknown as { secretStorage?: { setSecret?(key: string, value: string): unknown } }).secretStorage;
					if (storage && typeof storage.setSecret === 'function') {
						try {
							const res = storage.setSecret(key, raw);
							if (res && typeof (res as { then?: unknown }).then === 'function') await (res as Promise<unknown>);
							inst.apiToken = key;
							await this.plugin.saveSettings();
						} catch (e) {
							console.error('Failed to save token', e);
						}
					}
				}));
	}

	private async runValidateAuthForInstance(inst: ConfluenceInstance): Promise<void> {
		const resultEl = this.authResultEls.get(inst.id);
		if (!resultEl) return;
		resultEl.removeClass('ok', 'error');
		resultEl.setText(t('settings.validate.pending'));
		try {
			const tokenValue = await this.plugin.getApiTokenValueForInstance(inst.id);
			const needsUsername = inst.authType === 'basic';
			if (!inst.baseUrl || (needsUsername && !inst.username) || !tokenValue) {
				resultEl.addClass('error');
				resultEl.setText(needsUsername ? t('settings.validate.missingBasic') : t('settings.validate.missingBearer'));
				return;
			}
			const api = new ConfluenceApi({
				baseUrl: inst.baseUrl,
				authType: inst.authType,
				username: inst.username,
				apiToken: tokenValue,
			});
			const r = await api.validateAuth();
			if (r.ok) {
				resultEl.addClass('ok');
				resultEl.setText(t('settings.validate.ok', { name: r.displayName ?? '' }));
			} else {
				resultEl.addClass('error');
				resultEl.setText(t('settings.validate.fail', { error: r.error ?? '' }));
			}
		} catch (e) {
			resultEl.addClass('error');
			resultEl.setText(t('settings.validate.exception', { error: e instanceof Error ? e.message : String(e) }));
		}
	}
}
