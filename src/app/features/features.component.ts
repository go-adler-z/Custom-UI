import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { FEATURES, Feature } from '../data/features-catalog';

type FilterMode = 'all' | 'zero-config' | 'needs-config';

interface FeatureGroup {
  page: string;
  icon: string;
  features: Feature[];
}

@Component({
  selector: 'app-features',
  standalone: true,
  imports: [CommonModule, RouterLink, MatIconModule, FormsModule],
  templateUrl: './features.component.html',
  styleUrl: './features.component.scss',
})
export class FeaturesComponent {
  searchQuery = '';
  filterMode: FilterMode = 'all';

  readonly allFeatures: Feature[] = FEATURES;

  readonly pageIcons: Record<string, string> = {
    invoice_details:  'receipt',
    invoice_new:      'receipt_long',
    job_details:      'work',
    job_new:          'work_history',
    job_list:         'list_alt',
    project_details:  'folder',
    product_list:     'inventory_2',
    product_details:  'inventory',
    report_list:      'bar_chart',
    timesheet_list:   'schedule',
    dispatch_board:   'calendar_month',
    estimate_details: 'request_quote',
    asset_details:    'hardware',
    dashboard:        'dashboard',
  };

  get filteredFeatures(): Feature[] {
    const q = this.searchQuery.toLowerCase().trim();
    return this.allFeatures.filter(f => {
      const matchesFilter =
        this.filterMode === 'all' ? true :
        this.filterMode === 'zero-config' ? f.requiredConfig.length === 0 :
        f.requiredConfig.length > 0;

      if (!q) return matchesFilter;
      return matchesFilter && (
        f.id.toLowerCase().includes(q) ||
        f.label.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.pages.some(p => p.includes(q))
      );
    });
  }

  get groupedFilteredFeatures(): FeatureGroup[] {
    const map = new Map<string, Feature[]>();
    for (const f of this.filteredFeatures) {
      const page = f.pages[0] ?? 'standalone';
      if (!map.has(page)) map.set(page, []);
      map.get(page)!.push(f);
    }
    return Array.from(map.entries()).map(([page, features]) => ({
      page,
      icon: this.pageIcons[page] ?? 'web',
      features,
    }));
  }

  get zeroConfigCount(): number {
    return this.allFeatures.filter(f => f.requiredConfig.length === 0).length;
  }

  pageIcon(page: string): string {
    return this.pageIcons[page] ?? 'web';
  }

  setFilter(mode: FilterMode): void {
    this.filterMode = mode;
  }
}
