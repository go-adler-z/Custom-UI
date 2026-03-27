import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-nav',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, MatIconModule],
  templateUrl: './nav.component.html',
  styleUrl: './nav.component.scss',
})
export class NavComponent {
  @Input() isDark = false;
  @Output() toggleTheme = new EventEmitter<void>();

  constructor(private readonly router: Router) {}

  get isAuthed(): boolean {
    return !!localStorage.getItem('auth_token');
  }

  get userEmail(): string {
    try {
      const u = JSON.parse(localStorage.getItem('user') ?? '{}');
      return u.email ?? '';
    } catch {
      return '';
    }
  }

  logout(): void {
    ['auth_token', 'stream_token', 'stream_app_key', 'expires_at', 'user'].forEach(k =>
      localStorage.removeItem(k)
    );
    this.router.navigate(['/login']);
  }
}
