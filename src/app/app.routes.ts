import { Routes } from '@angular/router';
import { LoginComponent } from './login/login.component';
import { UiBuilderComponent } from './ui-builder/ui-builder.component';
import { HomeComponent } from './home/home.component';
import { FeaturesComponent } from './features/features.component';
import { authGuard, guestGuard } from './auth.guard';

export const routes: Routes = [
  { path: '',         component: HomeComponent },
  { path: 'home',     redirectTo: '', pathMatch: 'full' },
  { path: 'login',    component: LoginComponent,      canActivate: [guestGuard] },
  { path: 'builder',  component: UiBuilderComponent,  canActivate: [authGuard]  },
  { path: 'features', component: FeaturesComponent },
  { path: '**',       redirectTo: '' },
];
