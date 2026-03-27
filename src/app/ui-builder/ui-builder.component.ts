import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';

import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatBadgeModule } from '@angular/material/badge';

import { FEATURES, Feature, ConfigField } from '../data/features-catalog';
import { CodeGeneratorService, SelectedFeature } from '../services/code-generator.service';
import { SyntaxHighlightPipe } from '../pipes/syntax-highlight.pipe';
import { DecimalPipe } from '@angular/common';

interface GroupedFeatures {
  label: string;
  features: Feature[];
}

@Component({
  selector: 'app-ui-builder',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatExpansionModule,
    MatIconModule,
    MatTooltipModule,
    MatChipsModule,
    MatDividerModule,
    MatBadgeModule,
    SyntaxHighlightPipe,
    DecimalPipe,
  ],
  templateUrl: './ui-builder.component.html',
  styleUrl: './ui-builder.component.scss',
})
export class UiBuilderComponent implements OnInit {
  // ── State ───────────────────────────────────────────────────────────────────
  searchQuery = '';
  selectedMap = new Map<string, SelectedFeature>();   // feature.id → SelectedFeature
  generatedCode = '';
  copyLabel = 'Copy';
  deployLabel: 'Deploy' | 'Deploying…' | 'Deployed!' | 'Failed' = 'Deploy';
  activeTab: 'configure' | 'output' = 'configure';
  editingUid: string | null = null;   // set when opened via "Edit" from home
  activeInfoId: string | null = null;

  // ── Derived ─────────────────────────────────────────────────────────────────
  allFeatures = FEATURES;
  groups: GroupedFeatures[] = [];

  constructor(
    private readonly codeGen: CodeGeneratorService,
    private readonly router: Router,
    private readonly http: HttpClient,
  ) {}

  ngOnInit(): void {
    this.buildGroups();
    this.restoreFromNavigationState();
  }

  private restoreFromNavigationState(): void {
    this.editingUid = history.state?.editUid ?? null;
    const editMeta = history.state?.editMeta as { features: Array<{ id: string; config: Record<string, string> }> } | null;
    if (!editMeta?.features?.length) return;

    this.selectedMap.clear();
    for (const { id, config } of editMeta.features) {
      const feature = this.allFeatures.find(f => f.id === id);
      if (!feature) continue;
      const defaultConfig: Record<string, string> = {};
      for (const field of feature.requiredConfig) {
        defaultConfig[field.key] = config[field.key] ?? field.default ?? '';
      }
      this.selectedMap.set(feature.id, { feature, config: defaultConfig });
    }
    this.regenerate();
    this.activeTab = 'configure';
  }

  // ─── Search & groups ────────────────────────────────────────────────────────

  get filteredGroups(): GroupedFeatures[] {
    const q = this.searchQuery.toLowerCase();
    if (!q) return this.groups;
    return this.groups
      .map(g => ({ ...g, features: g.features.filter(f =>
        f.label.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.id.toLowerCase().includes(q)
      )}))
      .filter(g => g.features.length > 0);
  }

  get selectedFeatures(): SelectedFeature[] {
    return [...this.selectedMap.values()];
  }

  get selectedCount(): number {
    return this.selectedMap.size;
  }

  get filteredCount(): number {
    return this.filteredGroups.reduce((s, g) => s + g.features.length, 0);
  }

  isSelected(id: string): boolean {
    return this.selectedMap.has(id);
  }

  // ─── Toggle a feature on/off ────────────────────────────────────────────────

  toggleFeature(feature: Feature): void {
    if (this.selectedMap.has(feature.id)) {
      this.selectedMap.delete(feature.id);
    } else {
      const defaultConfig: Record<string, string> = {};
      feature.requiredConfig.forEach((f: ConfigField) => {
        defaultConfig[f.key] = f.default ?? '';
      });
      this.selectedMap.set(feature.id, { feature, config: defaultConfig });
    }
    this.regenerate();
  }

  // ─── Config field update ─────────────────────────────────────────────────────

  updateConfig(featureId: string, key: string, value: string): void {
    const sf = this.selectedMap.get(featureId);
    if (sf) {
      sf.config[key] = value;
      this.regenerate();
    }
  }

  getConfigValue(featureId: string, key: string): string {
    return this.selectedMap.get(featureId)?.config[key] ?? '';
  }

  // ─── Code generation ────────────────────────────────────────────────────────

  regenerate(): void {
    this.generatedCode = this.codeGen.generate(this.selectedFeatures);
  }

  // ─── Output actions ─────────────────────────────────────────────────────────

  downloadJs(): void {
    if (!this.generatedCode) return;
    const blob = new Blob([this.generatedCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'index.js';
    a.click();
    URL.revokeObjectURL(url);
  }

  deployToApi(): void {
    if (!this.generatedCode || this.deployLabel === 'Deploying…') return;
    const token = localStorage.getItem('auth_token');
    const apiUrl = localStorage.getItem('api_url');
    if (!token || !apiUrl) return;

    this.deployLabel = 'Deploying…';
    const base = apiUrl.replace(/\/$/, '');
    const headers = new HttpHeaders({
      'x-zuper-client': 'WEB_APP',
      'x-zuper-client-version': '3.0',
      'Content-Type': 'application/json',
      authorization: `Bearer ${token}`,
    });

    const isUpdate = !!this.editingUid;
    const url = isUpdate
      ? `${base}/api/misc/custom_code/${this.editingUid}`
      : `${base}/api/misc/custom_code`;
    const body = {
      custom_code: {
        custom_code_type: 'JS',
        custom_code: this.generatedCode,
        is_v3: true,
        ...(isUpdate ? { custom_code_uid: this.editingUid } : {}),
      },
    };

    const request$ = isUpdate
      ? this.http.put(url, body, { headers })
      : this.http.post(url, body, { headers });

    request$.subscribe({
      next: () => {
        this.deployLabel = 'Deployed!';
        if (isUpdate) this.editingUid = null;   // clear edit mode after successful update
        setTimeout(() => (this.deployLabel = 'Deploy'), 3000);
      },
      error: () => {
        this.deployLabel = 'Failed';
        setTimeout(() => (this.deployLabel = 'Deploy'), 3000);
      },
    });
  }

  async copyCode(): Promise<void> {
    if (!this.generatedCode) return;
    try {
      await navigator.clipboard.writeText(this.generatedCode);
      this.copyLabel = 'Copied!';
      setTimeout(() => (this.copyLabel = 'Copy'), 2000);
    } catch {
      this.copyLabel = 'Failed';
      setTimeout(() => (this.copyLabel = 'Copy'), 2000);
    }
  }

  toggleInfo(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.activeInfoId = this.activeInfoId === id ? null : id;
  }

  clearAll(): void {
    this.selectedMap.clear();
    this.generatedCode = '';
  }

  logout(): void {
    ['auth_token', 'stream_token', 'stream_app_key', 'expires_at', 'user'].forEach(k =>
      localStorage.removeItem(k)
    );
    this.router.navigate(['/login']);
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private buildGroups(): void {
    const pageLabels: Record<string, string> = {
      invoice_details:  'Invoice Details',
      invoice_new:      'New Invoice',
      job_details:      'Job Details',
      job_new:          'New Job',
      job_list:         'Job List',
      project_details:  'Project Details',
      product_list:     'Product List',
      product_details:  'Product Details',
      timesheet_list:   'Timesheet List',
      report_list:      'Report List',
      dispatch_board:   'Dispatch Board',
    };

    // Features with pages[] get grouped under their first page.
    // Features with no pages (global init only) get grouped under "Global / App-wide".
    const groupMap = new Map<string, Feature[]>();
    groupMap.set('Global / App-wide', []);

    for (const feature of FEATURES) {
      if (feature.pages.length === 0) {
        groupMap.get('Global / App-wide')!.push(feature);
      } else {
        const key = feature.pages[0];
        const label = pageLabels[key] ?? key;
        if (!groupMap.has(label)) groupMap.set(label, []);
        groupMap.get(label)!.push(feature);
      }
    }

    this.groups = [...groupMap.entries()]
      .filter(([, features]) => features.length > 0)
      .map(([label, features]) => ({ label, features }));
  }

  trackById(_: number, item: Feature): string { return item.id; }
  trackByKey(_: number, field: ConfigField): string { return field.key; }
  trackByPage(_: number, group: GroupedFeatures): string { return group.label; }
}
