import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { RoomComponent } from './pages/room/room.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  // Back button / swipe-back / ← all go through canLeave(), which asks before leaving a running game
  { path: 'room/:code', component: RoomComponent, canDeactivate: [(c: RoomComponent) => c.canLeave()] },
  { path: '**', redirectTo: '' },
];
