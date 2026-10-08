/**
 * The eleven pages, in the order a commander reads them.
 *
 * One list, used three times: the sidebar renders it, the router matches it, and the
 * narrow-screen top bar takes its label from it. Adding a page means adding a row here
 * and nothing else.
 *
 * The grouping is the reading order, from now to the past. Today answers "what is the
 * battalion today" and Duty Roster "who is on duty". The medical pages answer the same
 * questions of report sick, MC and status in turn; Trends is the battalion over the range.
 * Training is self-regulated fitness training; Soldier looks one person up. Admin is
 * whether parade states arrive on time and add up, where a clerk deposits or corrects one,
 * and the settings the rest read from.
 */

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
} from './icons.jsx';
import { Today } from '../pages/today/Today.jsx';
import { Trends } from '../pages/Trends.jsx';
import { Filing } from '../pages/Filing.jsx';
import { ReportSick } from '../pages/ReportSick.jsx';
import { McMa } from '../pages/McMa.jsx';
import { Status } from '../pages/Status.jsx';
import { Sft } from '../pages/Sft.jsx';
import { Soldier } from '../pages/Soldier.jsx';
import { DutyRoster } from '../pages/DutyRoster.jsx';
import { Deposit } from '../pages/Deposit.jsx';
import { Settings } from '../pages/Settings.jsx';

/**
 * Every page: its route, its component, its label, its icon, and the sidebar group it sits in.
 * @type {!Array<{path: string, component: function, label: string, group: string, icon: function}>}
 */
export const ROUTES = [
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

/**
 * Old paths and where they went, so a bookmark from before a rename still opens its page.
 * @type {!Object<string, string>}
 */
export const ROUTE_ALIASES = {
  '/overview': '/today',
  '/status': '/status-restrictions',
};

/** @type {string} Where an unknown or empty hash lands. */
export const DEFAULT_ROUTE = '/today';

/**
 * Groups the routes for the sidebar, keeping declaration order.
 *
 * A route with no group name renders in an unlabelled block.
 * @returns {!Array<{name: string, routes: !Array<!Object>}>} Groups in sidebar order.
 */
export function navGroups() {
  const groups = [];
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

/**
 * Finds the route a path names.
 * @param {string} path The current route path.
 * @returns {?Object} The route, or null when the path names none.
 */
export function routeAt(path) {
  return ROUTES.find((route) => route.path === path) || null;
}
