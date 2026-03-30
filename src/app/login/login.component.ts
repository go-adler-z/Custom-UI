import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatCardModule, MatIconModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  company = '';
  email = '';
  password = '';
  showPassword = false;
  region = '';
  regionLoading = false;
  regionError = '';
  loginLoading = false;
  loginError = '';
  private configApiUrl = '';
  private companyDebounce?: ReturnType<typeof setTimeout>;
  private lastRequestId = 0;

  constructor(private http: HttpClient, private router: Router) {}

  onCompanyChange(value: string): void {
    this.company = value;
    this.region = '';
    this.regionError = '';
    this.configApiUrl = '';
    this.loginError = '';
    if (this.companyDebounce) {
      clearTimeout(this.companyDebounce);
    }
    if (!value.trim()) {
      this.regionLoading = false;
      return;
    }
    this.regionLoading = true;
    this.companyDebounce = setTimeout(() => {
      this.fetchConfig(value.trim());
    }, 400);
  }

  onSubmit(): void {
    this.loginError = '';
    if (!this.configApiUrl) {
      this.loginError = 'Select a valid company to continue.';
      return;
    }
    if (!this.email || !this.password) {
      this.loginError = 'Email and password are required.';
      return;
    }
    this.loginLoading = true;
    const url = `${this.configApiUrl.replace(/\/$/, '')}/api/user/login`;
    const headers = new HttpHeaders({
      'x-zuper-client': 'WEB_APP',
      'x-zuper-client-version': '3.0',
      authorization: 'Bearer null',
      'Content-Type': 'application/json'
    });
    const body = {
      company_login_name: this.company.trim(),
      email: this.email.trim(),
      password: this.password
    };
    this.http.post<unknown>(url, body, { headers }).subscribe({
      next: (response) => {
        this.loginLoading = false;
        const parsed = response as Partial<LoginResponse>;
        if (parsed?.type !== 'success' || !parsed?.auth_token) {
          this.loginError = 'Login failed. Check your credentials.';
          return;
        }
        localStorage.setItem('auth_token', parsed.auth_token);
        localStorage.setItem('api_url', this.configApiUrl);
        if (parsed.stream_token) {
          localStorage.setItem('stream_token', parsed.stream_token);
        }
        if (parsed.stream_app_key) {
          localStorage.setItem('stream_app_key', parsed.stream_app_key);
        }
        if (parsed.expires_at) {
          localStorage.setItem('expires_at', parsed.expires_at);
        }
        if (parsed.user) {
          localStorage.setItem('user', JSON.stringify(parsed.user));
        }
        this.router.navigate(['/']);
      },
      error: () => {
        this.loginLoading = false;
        this.loginError = 'Login failed. Check your credentials.';
      }
    });
  }

  private fetchConfig(company: string): void {
    const requestId = ++this.lastRequestId;
    const url = 'https://accounts.zuperpro.com/api/config';
    const headers = new HttpHeaders({
      'x-zuper-client': 'WEB_APP',
      'x-zuper-client-version': '3.0',
      authorization: 'Bearer null',
      'Content-Type': 'application/json'
    });
    const body = { company_name: company };

    this.http.post<unknown>(url, body, { headers }).subscribe({
      next: (response) => {
        if (requestId !== this.lastRequestId) {
          return;
        }
        this.regionLoading = false;
        this.region = this.extractRegion(response);
        this.configApiUrl = this.extractApiUrl(response);
        if (!this.region) {
          this.regionError = 'Region not found for this company.';
        }
      },
      error: () => {
        if (requestId !== this.lastRequestId) {
          return;
        }
        this.regionLoading = false;
        this.regionError = 'Unable to fetch region. Try again.';
      }
    });
  }

  private extractRegion(response: unknown): string {
    if (!response || typeof response !== 'object') {
      return '';
    }
    const payload = response as Record<string, unknown>;
    const direct = payload['region'];
    if (typeof direct === 'string') {
      return direct;
    }
    const data = payload['data'];
    if (data && typeof data === 'object') {
      const region = (data as Record<string, unknown>)['region'];
      if (typeof region === 'string') {
        return region;
      }
    }
    const config = payload['config'];
    if (config && typeof config === 'object') {
      const configMap = config as Record<string, unknown>;
      const dcCountry = configMap['dc_country'];
      if (typeof dcCountry === 'string') {
        return dcCountry;
      }
      const dcName = configMap['dc_name'];
      if (typeof dcName === 'string') {
        return dcName;
      }
    }
    return '';
  }

  private extractApiUrl(response: unknown): string {
    if (!response || typeof response !== 'object') {
      return '';
    }
    const payload = response as Record<string, unknown>;
    const config = payload['config'];
    if (config && typeof config === 'object') {
      const apiUrl = (config as Record<string, unknown>)['dc_api_url'];
      if (typeof apiUrl === 'string') {
        return apiUrl;
      }
    }
    return '';
  }
}

interface LoginResponse {
  auth_token: string;
  expires_at?: string;
  stream_token?: string;
  stream_app_key?: string;
  type?: string;
  user?: {
    user_uid?: string;
    email?: string;
    role?: string;
    first_name?: string;
    last_name?: string;
    profile_picture?: string;
    custom_fields?: Array<unknown>;
  };
}
