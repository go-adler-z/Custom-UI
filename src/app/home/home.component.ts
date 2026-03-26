import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

export interface CompanyData {
  company_uid: string;
  company_name: string;
  company_phone: string;
  company_logo: string;
  company_address: string;
  company_timezone: string;
  company_currency: string;
  company_country: string;
  company_login_name: string;
  company_industry: string;
  company_status: string;
  company_email: string;
  created_at: string;
}

export interface CustomCode {
  custom_code_uid: string;
  custom_code_type: string;
  custom_code?: string;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomCodeDetail extends CustomCode {
  custom_code: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, CommonModule, MatIconModule, FormsModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit {
  company: CompanyData | null = null;
  companyLoading = false;
  companyError = '';

  customCodes: CustomCode[] = [];
  customCodesLoading = false;
  customCodesError = '';

  showNewForm = false;
  newCodeValue = '';
  newCodeType = 'JS';
  deploying = false;
  deployError = '';
  deploySuccess = false;

  selectedCode: CustomCode | null = null;
  codeDetail: CustomCodeDetail | null = null;
  codeDetailLoading = false;
  codeDetailError = '';

  confirmDialog = {
    visible: false,
    message: '',
    onConfirm: () => {},
    onCancel: () => { this.confirmDialog.visible = false; },
  };

  private showConfirm(message: string): Promise<boolean> {
    return new Promise(resolve => {
      this.confirmDialog.message = message;
      this.confirmDialog.visible = true;
      this.confirmDialog.onConfirm = () => { this.confirmDialog.visible = false; resolve(true); };
      this.confirmDialog.onCancel = () => { this.confirmDialog.visible = false; resolve(false); };
    });
  }

  readonly features = [
    { icon: 'extension',       title: '48 SDK Features',          desc: 'Invoice workflows, timesheet tracking, dispatch board, IFRAME embeds — all ready to use.' },
    { icon: 'tune',            title: 'Visual Configuration',      desc: 'Configure webhook URLs and settings through a clean form UI. No code editing required.' },
    { icon: 'download',        title: 'One-click Download',        desc: 'Generates a production-ready index.js that drops straight into ZuperPro.' },
    { icon: 'hub',             title: 'Multi-page Support',        desc: 'Features span job_details, invoice_new, dispatch_board, product_list, and more.' },
    { icon: 'webhook',         title: 'Webhook Ready',             desc: 'Every feature connects to n8n or internal REST workflows straight out of the box.' },
    { icon: 'auto_awesome',    title: 'Clean Code Output',         desc: 'Generated code follows the exact SDK patterns proven across 32 real client deployments.' },
  ];

  readonly stats = [
    { value: '48', label: 'SDK Features' },
    { value: '32', label: 'Client Implementations' },
    { value: '12', label: 'Page Types Supported' },
    { value: '100%', label: 'Production Ready' },
  ];

  readonly steps = [
    { n: '01', title: 'Sign in',         desc: 'Login with your ZuperPro credentials to access the builder.' },
    { n: '02', title: 'Select features', desc: 'Browse 48 pre-built features and check the ones you need.' },
    { n: '03', title: 'Configure',       desc: 'Fill in your webhook URLs and any custom settings.' },
    { n: '04', title: 'Download',        desc: 'Hit download and deploy your index.js to ZuperPro.' },
  ];

  constructor(private http: HttpClient, private router: Router) {}

  ngOnInit(): void {
    const token = localStorage.getItem('auth_token');
    const apiUrl = localStorage.getItem('api_url');
    if (token && apiUrl) {
      this.fetchCompany(apiUrl, token);
      this.fetchCustomCodes(apiUrl, token);
    }
  }

  get isAuthed(): boolean {
    return !!localStorage.getItem('auth_token');
  }

  get industryLabel(): string {
    return this.company?.company_industry
      ? this.company.company_industry.replace(/_/g, ' ')
      : '';
  }

  get memberSince(): string {
    if (!this.company?.created_at) return '';
    return new Date(this.company.created_at).getFullYear().toString();
  }

  get activeCount(): number {
    return this.customCodes.filter(c => c.is_active).length;
  }

  formatDate(iso: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  shortUid(uid: string): string {
    return uid ? uid.slice(0, 8) + '…' : '—';
  }

  isV3(code: CustomCode): boolean {
    return !!code.custom_code?.includes('window.ZClient.init()');
  }

  isBuilderGenerated(code: CustomCode): boolean {
    return !!code.custom_code?.includes('Generated by Xtra Custom UI Builder');
  }

  hasBuilderMeta(code: CustomCode): boolean {
    return !!code.custom_code?.includes('@builder-meta:');
  }

  async deleteCode(event: MouseEvent, code: CustomCode): Promise<void> {
    event.stopPropagation();
    const confirmed = await this.showConfirm(`Delete deployment ${code.custom_code_uid.slice(0, 8)}…? This cannot be undone.`);
    if (!confirmed) return;

    const token = localStorage.getItem('auth_token');
    const apiUrl = localStorage.getItem('api_url');
    if (!token || !apiUrl) return;

    const url = `${apiUrl.replace(/\/$/, '')}/api/misc/custom_code/${code.custom_code_uid}`;
    const headers = new HttpHeaders({
      'x-zuper-client': 'WEB_APP',
      'x-zuper-client-version': '3.0',
      authorization: `Bearer ${token}`,
    });

    this.http.delete(url, { headers }).subscribe({
      next: () => {
        this.customCodes = this.customCodes.filter(c => c.custom_code_uid !== code.custom_code_uid);
        if (this.selectedCode?.custom_code_uid === code.custom_code_uid) {
          this.selectedCode = null;
          this.codeDetail = null;
        }
      },
      error: () => this.showConfirm('Delete failed. Check your permissions.'),
    });
  }

  editWithBuilder(event: MouseEvent, code: CustomCode): void {
    event.stopPropagation();
    const match = code.custom_code?.match(/\/\/ @builder-meta: (.+)/);
    let editMeta: unknown = null;
    if (match) {
      try { editMeta = JSON.parse(match[1]); } catch {}
    }
    this.router.navigate(['/builder'], { state: { editMeta, editUid: code.custom_code_uid } });
  }

  toggleNewForm(): void {
    this.showNewForm = !this.showNewForm;
    if (!this.showNewForm) {
      this.newCodeValue = '';
      this.deployError = '';
      this.deploySuccess = false;
    }
  }

  deployCode(): void {
    if (!this.newCodeValue.trim()) return;
    const token = localStorage.getItem('auth_token');
    const apiUrl = localStorage.getItem('api_url');
    if (!token || !apiUrl) return;

    this.deploying = true;
    this.deployError = '';
    this.deploySuccess = false;

    const url = `${apiUrl.replace(/\/$/, '')}/api/misc/custom_code`;
    const headers = new HttpHeaders({
      'x-zuper-client': 'WEB_APP',
      'x-zuper-client-version': '3.0',
      'Content-Type': 'application/json',
      authorization: `Bearer ${token}`,
    });
    const body = {
      custom_code: {
        custom_code_type: this.newCodeType,
        custom_code: this.newCodeValue.trim(),
        is_v3: true,
      },
    };

    this.http.post<{ type: string; data: CustomCode }>(url, body, { headers }).subscribe({
      next: (res) => {
        this.deploying = false;
        if (res?.type === 'success' && res?.data) {
          this.customCodes = [res.data, ...this.customCodes];
          this.deploySuccess = true;
          this.newCodeValue = '';
          setTimeout(() => {
            this.showNewForm = false;
            this.deploySuccess = false;
          }, 1800);
        } else {
          this.deployError = 'Deployment failed. Check your code and try again.';
        }
      },
      error: () => {
        this.deploying = false;
        this.deployError = 'Deployment failed. The API may require an API key instead of a Bearer token.';
      },
    });
  }

  private fetchCompany(apiUrl: string, token: string): void {
    this.companyLoading = true;
    const url = `${apiUrl.replace(/\/$/, '')}/api/user/company`;
    const headers = new HttpHeaders({
      'x-zuper-client': 'WEB_APP',
      'x-zuper-client-version': '3.0',
      authorization: `Bearer ${token}`,
    });
    this.http.get<{ type: string; data: CompanyData }>(url, { headers }).subscribe({
      next: (res) => {
        this.companyLoading = false;
        if (res?.type === 'success' && res?.data) {
          this.company = res.data;
        }
      },
      error: () => {
        this.companyLoading = false;
        this.companyError = 'Could not load company details.';
      },
    });
  }

  openCodeDetail(code: CustomCode): void {
    this.selectedCode = code;
    this.codeDetail = null;
    this.codeDetailError = '';
    this.codeDetailLoading = true;

    const token = localStorage.getItem('auth_token');
    const apiUrl = localStorage.getItem('api_url');
    if (!token || !apiUrl) return;

    const url = `${apiUrl.replace(/\/$/, '')}/api/misc/custom_code/${code.custom_code_uid}`;
    const headers = new HttpHeaders({
      'x-zuper-client': 'WEB_APP',
      'x-zuper-client-version': '3.0',
      authorization: `Bearer ${token}`,
    });

    this.http.get<{ type: string; data: CustomCodeDetail }>(url, { headers }).subscribe({
      next: (res) => {
        this.codeDetailLoading = false;
        if (res?.type === 'success' && res?.data) {
          this.codeDetail = res.data;
        } else {
          this.codeDetailError = 'Could not load code details.';
        }
      },
      error: () => {
        this.codeDetailLoading = false;
        this.codeDetailError = 'Failed to fetch code details.';
      },
    });
  }

  closeDetail(): void {
    this.selectedCode = null;
    this.codeDetail = null;
    this.codeDetailError = '';
  }

  copyDetailCode(): void {
    if (this.codeDetail?.custom_code) {
      navigator.clipboard.writeText(this.codeDetail.custom_code);
    }
  }

  private fetchCustomCodes(apiUrl: string, token: string): void {
    this.customCodesLoading = true;
    const base = apiUrl.replace(/\/$/, '');
    const headers = new HttpHeaders({
      'x-zuper-client': 'WEB_APP',
      'x-zuper-client-version': '3.0',
      authorization: `Bearer ${token}`,
    });

    this.http.get<{ type: string; data: CustomCode[] }>(`${base}/api/misc/custom_code`, { headers }).subscribe({
      next: (res) => {
        if (res?.type === 'success' && Array.isArray(res?.data)) {
          const codes = res.data.filter(c => !c.is_deleted);
          this.customCodes = codes;

          // Fetch each code's details in parallel to resolve custom_code for v3 detection
          const detail$ = codes.map(code =>
            this.http.get<{ type: string; data: CustomCodeDetail }>(
              `${base}/api/misc/custom_code/${code.custom_code_uid}`, { headers }
            ).pipe(
              map(r => r?.data ?? null),
              catchError(() => of(null))
            )
          );

          forkJoin(detail$.length ? detail$ : [of(null)]).subscribe(details => {
            this.customCodesLoading = false;
            details.forEach((detail, i) => {
              if (detail && codes[i]) {
                codes[i].custom_code = detail.custom_code;
              }
            });
            this.customCodes = [...codes];
          });
        } else {
          this.customCodesLoading = false;
        }
      },
      error: () => {
        this.customCodesLoading = false;
        this.customCodesError = 'Could not load custom code deployments.';
      },
    });
  }
}
