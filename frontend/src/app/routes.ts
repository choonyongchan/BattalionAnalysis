/**
 * The pages in reading order, from now to the past. One list feeds the sidebar, the router and the
 * narrow-screen title: adding a page means adding a row here and nothing else.
 */

import type { ComponentType } from 'preact';
import {
  DepositIcon,
  FilingIcon,
  McMaIcon,
  DutyRosterIcon,
  OverviewIcon,
  TrendsIcon,
  ReportSickIcon,
  SettingsIcon,
  SftIcon,
  SoldierIcon,
  StatusIcon,
} from './icons.tsx';
import { Today } from '../pages/today/Today.tsx';
import { Trends } from '../pages/Trends.tsx';
import { Filing } from '../pages/Filing.tsx';
import { ReportSick } from '../pages/ReportSick.tsx';
import { McMa } from '../pages/McMa.tsx';
import { Status } from '../pages/Status.tsx';
import { Sft } from '../pages/Sft.tsx';
import { Soldier } from '../pages/Soldier.tsx';
import { DutyRoster } from '../pages/DutyRoster.tsx';
import { Deposit } from '../pages/Deposit.tsx';
import { Settings } from '../pages/Settings.tsx';

/** One page: its hash path, component, label, sidebar group and icon. */
export interface PageRoute {
  path: string;
  component: ComponentType;
  label: string;
  group: string;
  icon: ComponentType<{ size?: number }>;
}

/** Every page, in sidebar order. */
export const ROUTES: PageRoute[] = [
  {
    path: '/today',
    component: Today,
    label: 'Today',
    group: 'Today',
    icon: OverviewIcon,
  },
  {
    path: '/duty-roster',
    component: DutyRoster,
    label: 'Duty Roster',
    group: 'Today',
    icon: DutyRosterIcon,
  },
  {
    path: '/report-sick',
    component: ReportSick,
    label: 'Report Sick',
    group: 'Medical',
    icon: ReportSickIcon,
  },
  {
    path: '/mc-ma',
    component: McMa,
    label: 'MC / MA',
    group: 'Medical',
    icon: McMaIcon,
  },
  {
    path: '/status-restrictions',
    component: Status,
    label: 'Status & Restrictions',
    group: 'Medical',
    icon: StatusIcon,
  },
  {
    path: '/trends',
    component: Trends,
    label: 'Trends',
    group: 'Medical',
    icon: TrendsIcon,
  },
  {
    path: '/sft',
    component: Sft,
    label: 'SFT',
    group: 'Training',
    icon: SftIcon,
  },
  {
    path: '/soldier',
    component: Soldier,
    label: 'Soldier',
    group: 'People',
    icon: SoldierIcon,
  },
  {
    path: '/filing',
    component: Filing,
    label: 'Filing & Accuracy',
    group: 'Admin',
    icon: FilingIcon,
  },
  {
    path: '/deposit',
    component: Deposit,
    label: 'Deposit',
    group: 'Admin',
    icon: DepositIcon,
  },
  {
    path: '/settings',
    component: Settings,
    label: 'Settings',
    group: 'Admin',
    icon: SettingsIcon,
  },
];

/** Old paths and where they went, so a bookmark from before a rename still opens its page. */
export const ROUTE_ALIASES: Record<string, string> = {
  '/overview': '/today',
  '/status': '/status-restrictions',
};

/** Where an unknown or empty hash lands. */
export const DEFAULT_ROUTE = '/today';

/** The routes grouped for the sidebar, in declaration order. */
export function navGroups(): { name: string; routes: PageRoute[] }[] {
  const groups: { name: string; routes: PageRoute[] }[] = [];
  ROUTES.forEach((route) => {
    const last = groups[groups.length - 1];
    if (last && last.name === route.group) {
      last.routes.push(route);
      return;
    }
    groups.push({ name: route.group, routes: [route] });
  });
  return groups;
}

/** The route a path names, or null. */
export function routeAt(path: string): PageRoute | null {
  return ROUTES.find((route) => route.path === path) ?? null;
}
