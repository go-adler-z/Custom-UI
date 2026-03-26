import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

const hasAuthToken = (): boolean => {
  return !!localStorage.getItem('auth_token');
};

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  if (hasAuthToken()) {
    return true;
  }
  router.navigate(['/login']);
  return false;
};

export const guestGuard: CanActivateFn = () => {
  const router = inject(Router);
  if (hasAuthToken()) {
    router.navigate(['/']);
    return false;
  }
  return true;
};
