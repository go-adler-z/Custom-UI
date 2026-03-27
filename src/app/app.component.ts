import { Component } from '@angular/core';
import { RouterOutlet, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { NavComponent } from './nav/nav.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, NavComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  isDark = false;

  constructor(public readonly router: Router) {}

  get showNav(): boolean {
    return !this.router.url.startsWith('/login');
  }

  toggleDark(): void {
    this.isDark = !this.isDark;
    document.body.classList.toggle('dark', this.isDark);
  }
}
